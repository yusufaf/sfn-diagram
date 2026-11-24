import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { assetManifestName, findNestedStackTemplates } from './cfn/cdkAsset';
import { readCloudAssemblyManifest } from './cfn/cdkAssembly';
import { matchStateMachinesInTemplates, toConstructPath } from './cfn/cdkPath';
import { listStateMachines, STATE_MACHINE_TYPES } from './cfn/extract';
import { CliInputError, toPosix } from './cliInputs';
import { createTemplateFileReader } from './cliTemplateFiles';
import { stripBom } from './utils/bom';

const MANIFEST_FILE = 'manifest.json';
const NESTED_SUFFIX = '.nested.template.json';
/** Characters Windows refuses in a filename, besides `/`, which separates construct IDs. */
const RESERVED_FILENAME_CHARACTERS = '<>:"\\|?*';

/** One state machine found in a CDK cloud assembly, ready to render as its own input. */
export interface CloudAssemblyMachine {
    /** The cloud assembly directory, as given on the command line. */
    assembly: string;
    /** Its logical ID in its template, which selects it there. */
    logicalId: string;
    /** Its construct path, such as `Prod/OrdersStack/OrderWorkflow`, or `<stack>/<logicalId>`. */
    name: string;
    /** The output filename without its extension, such as `Prod.OrdersStack.OrderWorkflow`. */
    outputStem: string;
    /** Its template's text, byte order mark removed. */
    template: string;
    /** Its template's path, under {@link CloudAssemblyMachine.assembly}, with `/` separators. */
    templatePath: string;
}

/** Parameters for {@link cloudAssemblyOutputStem}. */
export interface CloudAssemblyOutputStemParams {
    /** The machine's `aws:cdk:path`, when its template has one. */
    cdkPath?: string;
    /** The machine's logical ID. */
    logicalId: string;
    /** The stack's construct path, used with the logical ID when there is no `cdkPath`. */
    stackName: string;
}

/**
 * Names a cloud assembly machine's output file: its construct path with `/` as `.`, so
 * `Prod/OrdersStack/OrderWorkflow/Resource` becomes `Prod.OrdersStack.OrderWorkflow`.
 *
 * @param params - The machine's construct path, logical ID and stack name.
 * @returns The filename stem, with characters Windows refuses and control characters as `_`.
 *
 * @example
 * ```typescript
 * cloudAssemblyOutputStem({ cdkPath: 'Prod/OrdersStack/OrderWorkflow/Resource', logicalId: 'OrderWorkflow0015CDD9', stackName: 'Prod/OrdersStack' });
 * // 'Prod.OrdersStack.OrderWorkflow'
 * ```
 */
export function cloudAssemblyOutputStem(params: CloudAssemblyOutputStemParams): string {
    const { cdkPath, logicalId, stackName } = params;
    const base = cdkPath === undefined ? `${stackName}/${logicalId}` : toConstructPath({ cdkPath });
    const dotted = base
        .split('/')
        .filter((segment) => segment !== '')
        .join('.');
    const safe = [...dotted]
        .map((character) =>
            character.charCodeAt(0) < 0x20 || RESERVED_FILENAME_CHARACTERS.includes(character)
                ? '_'
                : character,
        )
        .join('')
        // Windows drops trailing dots and spaces from a filename, which could merge two outputs.
        .replace(/[. ]+$/, '');
    return safe === '' ? logicalId : safe;
}

/** Parameters for {@link expandCloudAssembly}. */
export interface ExpandCloudAssemblyParams {
    /** The directory, as given on the command line. */
    directory: string;
    /** The `--resource` value, which filters the machines, or `null` for all of them. */
    resource: string | null;
}

interface TemplateEntry {
    absolutePath: string;
    stackName: string;
}

interface FoundMachine {
    cdkPath?: string;
    logicalId: string;
    machine: CloudAssemblyMachine;
}

/** The system error code anywhere along an error's `cause` chain. */
function errorCode(error: unknown): string | undefined {
    for (let current = error; current instanceof Error; current = current.cause) {
        const { code } = current as NodeJS.ErrnoException;
        if (code !== undefined) {
            return code;
        }
    }
    return undefined;
}

function isMissing(error: unknown): boolean {
    const code = errorCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Reads one file of the assembly with the template reader's size and file-type checks. */
function readAssemblyFile(absolutePath: string): string {
    try {
        return createTemplateFileReader({ templatePath: absolutePath })({ path: absolutePath });
    } catch (error) {
        throw new CliInputError((error as Error).message, { cause: error });
    }
}

/**
 * Expands a CDK cloud assembly directory (`cdk.out`) into one input per state machine: those of
 * every stack, of every Stage's nested assembly, and of every nested stack template an asset
 * manifest lists.
 *
 * With a `resource`, only the machines it names are kept: a machine whose construct path (or
 * `<stack>/<logicalId>` name) is that value, else what `matchStateMachinesInTemplates` keeps.
 *
 * @param params - The directory and the `--resource` value.
 * @returns The machines sorted by output name, or `null` when the directory has no
 * `manifest.json` with an `artifacts` object, so is not a cloud assembly.
 * @throws {CliInputError} When a manifest names a network path, a file it lists cannot be read
 * or a template is not JSON, or no state machine is left.
 *
 * @example
 * ```typescript
 * expandCloudAssembly({ directory: 'cdk.out', resource: null })?.map((machine) => machine.name);
 * // ['OrdersStack/OrderWorkflow', 'Prod/OrdersStack/OrderWorkflow', ...]
 * ```
 */
export function expandCloudAssembly(params: ExpandCloudAssemblyParams): CloudAssemblyMachine[] | null {
    const { directory, resource } = params;
    const root = resolve(directory);
    const display = (absolutePath: string): string => {
        const inside = relative(root, absolutePath);
        return toPosix(isAbsolute(inside) ? absolutePath : join(directory, inside));
    };
    const resolveManifestPath = (base: string, manifestPath: string, value: string): string => {
        if (/^[\\/]{2}/.test(value)) {
            throw new CliInputError(
                `${display(manifestPath)} names '${value}', a network or device path; only local files are read`,
            );
        }
        const path = value.replace(/\\/g, '/');
        return resolve(isAbsolute(path) ? path : join(base, path));
    };

    const visited = new Set<string>();
    const templates: TemplateEntry[] = [];
    const addTemplate = (entry: TemplateEntry): void => {
        if (!templates.some((existing) => existing.absolutePath === entry.absolutePath)) {
            templates.push(entry);
        }
    };
    const visit = (assemblyDirectory: string, topLevel: boolean): boolean => {
        if (visited.has(assemblyDirectory)) {
            return true;
        }
        visited.add(assemblyDirectory);
        const manifestPath = join(assemblyDirectory, MANIFEST_FILE);
        let text: string;
        try {
            text = readAssemblyFile(manifestPath);
        } catch (error) {
            if (topLevel && isMissing(error)) {
                return false;
            }
            throw error;
        }
        const manifest = readCloudAssemblyManifest({ manifest: text });
        if (manifest === undefined) {
            if (topLevel) {
                return false;
            }
            throw new CliInputError(`${display(manifestPath)} is not a CDK cloud assembly manifest`);
        }
        for (const stack of manifest.stacks) {
            const templatePath = resolveManifestPath(assemblyDirectory, manifestPath, stack.templateFile);
            addTemplate({ absolutePath: templatePath, stackName: stack.displayName ?? stack.id });
            const assetsName = assetManifestName({ templateFileName: templatePath });
            if (assetsName === undefined) {
                continue;
            }
            const assetsPath = join(dirname(templatePath), assetsName);
            let assets: string;
            try {
                assets = readAssemblyFile(assetsPath);
            } catch (error) {
                // A legacy or custom synthesizer writes no asset manifest: no nested stacks to find.
                if (isMissing(error)) {
                    continue;
                }
                throw error;
            }
            for (const nested of findNestedStackTemplates({ manifest: assets })) {
                const nestedPath = resolveManifestPath(dirname(assetsPath), assetsPath, nested);
                addTemplate({
                    absolutePath: nestedPath,
                    stackName: basename(nestedPath).slice(0, -NESTED_SUFFIX.length),
                });
            }
        }
        for (const directoryName of manifest.nestedAssemblies) {
            visit(resolveManifestPath(assemblyDirectory, manifestPath, directoryName), false);
        }
        return true;
    };
    if (!visit(root, true)) {
        return null;
    }

    const groups: FoundMachine[][] = templates.map(({ absolutePath, stackName }) => {
        const templatePath = display(absolutePath);
        const template = stripBom(readAssemblyFile(absolutePath));
        let candidates;
        try {
            candidates = listStateMachines({ template });
        } catch {
            throw new CliInputError(`${templatePath} is not valid JSON`);
        }
        return candidates.map(({ cdkPath, logicalId }) => ({
            cdkPath,
            logicalId,
            machine: {
                assembly: directory,
                logicalId,
                name:
                    cdkPath === undefined ? `${stackName}/${logicalId}` : toConstructPath({ cdkPath }),
                outputStem: cloudAssemblyOutputStem({ cdkPath, logicalId, stackName }),
                template,
                templatePath,
            },
        }));
    });
    const found = groups.flat();

    let selected = found;
    if (resource !== null) {
        const wanted = resource.startsWith('/') ? resource.slice(1) : resource;
        const named = found.filter((candidate) => candidate.machine.name === wanted);
        selected =
            named.length > 0
                ? named
                : matchStateMachinesInTemplates({ resourceId: resource, templates: groups });
    }
    if (selected.length === 0) {
        if (resource !== null && found.length > 0) {
            const names = found.map((candidate) => candidate.machine.name).join(', ');
            throw new CliInputError(
                `No state machine in cloud assembly ${directory} matches --resource '${resource}'. Found: ${names}.`,
            );
        }
        throw new CliInputError(
            `Cloud assembly ${directory} has no ${STATE_MACHINE_TYPES.join(' or ')} resource in its ${templates.length} templates.`,
        );
    }
    const compare = (left: string, right: string): number =>
        left < right ? -1 : left > right ? 1 : 0;
    return selected
        .map((candidate) => candidate.machine)
        .sort(
            (left, right) =>
                compare(left.outputStem, right.outputStem) ||
                compare(left.templatePath, right.templatePath),
        );
}
