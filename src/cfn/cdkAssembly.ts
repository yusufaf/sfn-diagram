import { stripBom } from '../utils/bom';

const STACK_ARTIFACT = 'aws:cloudformation:stack';
const NESTED_ASSEMBLY_ARTIFACT = 'cdk:cloud-assembly';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A CloudFormation stack a cloud assembly manifest lists. */
export interface CloudAssemblyStack {
    /** Its construct path, such as `Prod/OrdersStack`, when the manifest gives one. */
    displayName?: string;
    /** Its artifact ID, such as `ProdOrdersStack2EDBF9CE`. */
    id: string;
    /** Its template file, relative to the manifest's directory. */
    templateFile: string;
}

/** The parts of a cloud assembly manifest that locate templates. */
export interface CloudAssemblyManifest {
    /** Each nested assembly's directory (one per CDK Stage), relative to the manifest's directory. */
    nestedAssemblies: string[];
    /** The stacks, in manifest order. */
    stacks: CloudAssemblyStack[];
}

/** Parameters for {@link readCloudAssemblyManifest}. */
export interface ReadCloudAssemblyManifestParams {
    /** The `manifest.json` text. */
    manifest: string;
}

/**
 * Reads the stacks and nested assemblies from a CDK cloud assembly `manifest.json`.
 *
 * Only `artifacts[*].type`, `.displayName`, `.properties.templateFile` and
 * `.properties.directoryName` are read, and the schema `version` is ignored, so newer manifest
 * versions keep working. Other artifact types are skipped.
 *
 * @param params - The manifest's text.
 * @returns The stacks and nested assembly directories, or `undefined` when the text is not JSON
 * or has no `artifacts` object, so is not a cloud assembly manifest.
 *
 * @example
 * ```typescript
 * readCloudAssemblyManifest({ manifest: readFileSync('cdk.out/manifest.json', 'utf8') });
 * // { nestedAssemblies: ['assembly-Prod'], stacks: [{ displayName: 'OrdersStack', id: 'OrdersStack', templateFile: 'OrdersStack.template.json' }] }
 * ```
 */
export function readCloudAssemblyManifest(
    params: ReadCloudAssemblyManifestParams,
): CloudAssemblyManifest | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stripBom(params.manifest));
    } catch {
        return undefined;
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.artifacts)) {
        return undefined;
    }
    const result: CloudAssemblyManifest = { nestedAssemblies: [], stacks: [] };
    for (const [id, artifact] of Object.entries(parsed.artifacts)) {
        if (!isPlainObject(artifact) || !isPlainObject(artifact.properties)) {
            continue;
        }
        if (artifact.type === STACK_ARTIFACT) {
            const templateFile = nonEmptyString(artifact.properties.templateFile);
            if (templateFile === undefined) {
                continue;
            }
            const displayName = nonEmptyString(artifact.displayName);
            result.stacks.push(
                displayName === undefined ? { id, templateFile } : { displayName, id, templateFile },
            );
        } else if (artifact.type === NESTED_ASSEMBLY_ARTIFACT) {
            const directoryName = nonEmptyString(artifact.properties.directoryName);
            if (directoryName !== undefined) {
                result.nestedAssemblies.push(directoryName);
            }
        }
    }
    return result;
}
