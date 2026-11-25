import { parse as parseYaml, YAMLParseError } from 'yaml';
import type {
    AslDefinition,
    ExtractAslFromTemplateParams,
    ExtractAslResult,
    ReadFileParams,
} from '../types';
import { parseAslSource } from '../AslParser';
import { stripBom } from '../utils/bom';
import { assetManifestName, findCdkAssetPath, isCdkAssetKey } from './cdkAsset';
import {
    formatMachineLabel,
    matchStateMachine,
    readCdkPath,
    type StateMachineCandidate,
} from './cdkPath';
import { applySubstitutions, resolveIntrinsics, resolveSubstitutions } from './intrinsics';
import { looksLikeJson, parseTemplate } from './templateParser';

/** Resource types that declare a Step Functions state machine: CloudFormation's own and SAM's. */
export const STATE_MACHINE_TYPES: readonly string[] = [
    'AWS::StepFunctions::StateMachine',
    'AWS::Serverless::StateMachine',
];

/** Properties that point at a definition stored elsewhere: SAM's, then CloudFormation's. */
const EXTERNAL_DEFINITION_KEYS: readonly string[] = ['DefinitionUri', 'DefinitionS3Location'];

const STATE_MACHINE_TYPE_LIST = STATE_MACHINE_TYPES.join(' or ');

interface CfnResource {
    Metadata?: unknown;
    Properties?: Record<string, unknown>;
    Type?: string;
}

function findStateMachines(resources: Record<string, CfnResource>): StateMachineCandidate[] {
    return Object.keys(resources)
        .filter((logicalId) => STATE_MACHINE_TYPES.includes(resources[logicalId]?.Type ?? ''))
        .map((logicalId) => {
            const cdkPath = readCdkPath({ metadata: resources[logicalId].Metadata });
            return cdkPath === undefined ? { logicalId } : { cdkPath, logicalId };
        });
}

/** Parameters for {@link listStateMachines}. */
export interface ListStateMachinesParams {
    /** A JSON CloudFormation template's text. */
    template: string;
}

/**
 * Lists a JSON template's state machine resources, as `--resource` matching sees them.
 *
 * @param params - The template's text.
 * @returns Each state machine's logical ID and `aws:cdk:path`, in template order; `[]` when the
 * template has no `Resources` object.
 * @throws What `JSON.parse` throws when the text is not JSON.
 */
export function listStateMachines(params: ListStateMachinesParams): StateMachineCandidate[] {
    const parsed: unknown = parseTemplate({ format: 'json', template: params.template });
    if (typeof parsed !== 'object' || parsed === null) {
        return [];
    }
    const resources = (parsed as Record<string, unknown>).Resources;
    if (typeof resources !== 'object' || resources === null || Array.isArray(resources)) {
        return [];
    }
    return findStateMachines(resources as Record<string, CfnResource>);
}

interface ParseDefinitionFileParams {
    /** Whether `text` has had `DefinitionSubstitutions` applied, which changes the message. */
    afterSubstitution: boolean;
    format: 'json' | 'yaml';
    /** Names the file in messages, such as `DefinitionUri file 'x' of state machine 'y'`. */
    subject: string;
    text: string;
}

/**
 * Parses a definition file without ever quoting it: the template's author picks the
 * path, so the file may be anything on the machine, and parser messages embed source text.
 */
function parseDefinitionFile(params: ParseDefinitionFileParams): unknown {
    const { afterSubstitution, format, subject, text } = params;
    try {
        return format === 'json' ? JSON.parse(text) : parseYaml(text, { logLevel: 'error' });
    } catch (error) {
        const kind = format === 'json' ? 'JSON' : 'YAML';
        if (afterSubstitution) {
            throw new Error(
                `${subject} is not valid ${kind} after DefinitionSubstitutions are applied.`,
                { cause: error },
            );
        }
        const line =
            error instanceof YAMLParseError && error.linePos !== undefined
                ? ` (line ${error.linePos[0].line})`
                : '';
        throw new Error(
            `${subject} is not valid ${kind}${line}. Render the file directly to see the parser's message.`,
            { cause: error },
        );
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ReadDefinitionUriParams {
    location: string;
    logicalId: string;
    readFile: (params: ReadFileParams) => string;
    substitutions: Record<string, string>;
}

/** Reads, substitutes and parses a local `DefinitionUri` file through the caller's `readFile`. */
function readDefinitionUri(params: ReadDefinitionUriParams): AslDefinition {
    const { location, logicalId, readFile, substitutions } = params;
    let text: string;
    try {
        text = readFile({ path: location });
    } catch (error) {
        throw new Error(
            `State machine '${logicalId}' loads its definition from DefinitionUri ('${location}'), ` +
                `which could not be read: ${errorReason(error)}`,
            { cause: error },
        );
    }
    return parseDefinitionText({
        subject: `DefinitionUri file '${location}' of state machine '${logicalId}'`,
        substitutions,
        text,
    });
}

function errorReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface ReadCdkAssetParams {
    /** The plain "cannot be read from the template alone" message, extended on a failed lookup. */
    diagnostic: string;
    logicalId: string;
    manifestName: string;
    objectKey: string;
    readFile: (params: ReadFileParams) => string;
    substitutions: Record<string, string>;
}

/** Reads a CDK `DefinitionBody.fromFile` asset through the `<stack>.assets.json` beside the template. */
function readCdkAsset(params: ReadCdkAssetParams): AslDefinition {
    const { diagnostic, logicalId, manifestName, objectKey, readFile, substitutions } = params;
    let manifest: string;
    try {
        manifest = readFile({ path: manifestName });
    } catch (error) {
        throw new Error(
            `${diagnostic} The CDK asset manifest beside the template could not be read: ${errorReason(error)}.`,
            { cause: error },
        );
    }
    const assetPath = findCdkAssetPath({ manifest, objectKey });
    if (assetPath === undefined) {
        throw new Error(
            `${diagnostic} The CDK asset manifest '${manifestName}' has no file asset with object key '${objectKey}'.`,
        );
    }
    if (/^[\\/]{2}/.test(assetPath)) {
        throw new Error(
            `State machine '${logicalId}' loads its definition from CDK asset '${assetPath}', ` +
                `which is a network or device path; only local files are read. Render that ASL file directly.`,
        );
    }
    let text: string;
    try {
        // CDK writes OS-native relative paths; a manifest synthesized on Windows uses `\`.
        text = readFile({ path: assetPath.replace(/\\/g, '/') });
    } catch (error) {
        throw new Error(`${diagnostic} Its CDK asset '${assetPath}' could not be read: ${errorReason(error)}.`, {
            cause: error,
        });
    }
    return parseDefinitionText({
        subject: `CDK asset '${assetPath}' of state machine '${logicalId}'`,
        substitutions,
        text,
    });
}

interface ParseDefinitionTextParams {
    /** Names the file in messages. */
    subject: string;
    substitutions: Record<string, string>;
    text: string;
}

/** Substitutes and parses a definition file's text, checking it is ASL without quoting it. */
function parseDefinitionText(params: ParseDefinitionTextParams): AslDefinition {
    const { subject, substitutions } = params;
    const text = stripBom(params.text);
    // Decided on the file's own text, so a substitution can't switch the parser.
    const format = looksLikeJson(text) ? 'json' : 'yaml';
    const notAsl = (): Error =>
        new Error(`${subject} is not an ASL definition (expected an object with StartAt and States).`);
    const hasSubstitutions = Object.keys(substitutions).length > 0;

    // Substitution is raw text, so a template's values could rebuild a non-ASL file into ASL
    // that carries the file's own lines. Check the file's structure first, with each
    // placeholder replaced by a distinct digit, which keeps `"Seconds":${Wait}` valid JSON and
    // substituted YAML keys distinct. YAML reads `StartAt: 0` as a number, so only its presence
    // is checked here.
    if (hasSubstitutions) {
        const neutral = Object.fromEntries(
            Object.keys(substitutions).map((name, index) => [name, String(index)]),
        );
        const neutralParsed = parseDefinitionFile({
            afterSubstitution: false,
            format,
            subject,
            text: applySubstitutions({ substitutions: neutral, value: text }) as string,
        });
        if (
            !isPlainObject(neutralParsed) ||
            !Object.hasOwn(neutralParsed, 'StartAt') ||
            !isPlainObject(neutralParsed.States)
        ) {
            throw notAsl();
        }
    }

    const parsed = parseDefinitionFile({
        afterSubstitution: hasSubstitutions,
        format,
        subject,
        text: applySubstitutions({ substitutions, value: text }) as string,
    });
    if (!isPlainObject(parsed) || typeof parsed.StartAt !== 'string' || !isPlainObject(parsed.States)) {
        throw notAsl();
    }
    return parsed as unknown as AslDefinition;
}

/**
 * Recovers a renderable ASL definition from a CloudFormation/SAM/CDK template.
 *
 * Locates the `AWS::StepFunctions::StateMachine` or SAM
 * `AWS::Serverless::StateMachine` resource (disambiguated with `resourceId`
 * when the template has more than one), flattens the intrinsics in its
 * `DefinitionString`/`Definition`, applies `DefinitionSubstitutions` to every
 * string in it (whichever form it takes), and parses the result as ASL. SAM
 * resources share the CloudFormation pipeline.
 *
 * `resourceId` is a logical ID, or for a CDK template the construct path of
 * the state machine: the `aws:cdk:path` that `cdk synth` writes (with or
 * without its trailing `/Resource`), the path relative to the stack
 * (`OrderWorkflow` for `OrderWorkflow0015CDD9`, worked out from CDK's logical
 * ID scheme, so it works without that metadata too), or a trailing part of
 * the path. An exact logical ID wins.
 *
 * A SAM state machine whose definition is a local `DefinitionUri` file is read
 * through `readFile` when one is given: its `DefinitionSubstitutions` are
 * applied to the file's text, which is then parsed as JSON or YAML. Errors
 * about that file never quote it.
 *
 * A CDK state machine built with `DefinitionBody.fromFile` has only a
 * `DefinitionS3Location`; with `readFile` and a `templateFileName` such as
 * `OrdersStack.template.json`, its staged asset is found through
 * `OrdersStack.assets.json` beside the template and read the same way.
 *
 * @param params - Template source, optional format, optional resource id,
 * optional `readFile` and `templateFileName` for definition files.
 * @returns The extracted ASL definition, the logical id used, and any warnings.
 * @throws If no state machine is found, `resourceId` matches none or more
 * than one, no `resourceId` is given and there are several, or the definition
 * is external and not readable (no `readFile`, an S3 location, a network
 * path, or a `DefinitionS3Location` with no CDK asset beside the template).
 *
 * @example
 * ```typescript
 * const { aslDefinition } = extractAslFromTemplate({ template: cdkSynthJson });
 * // Pick one of several by the ID passed to `new sfn.StateMachine(this, 'OrderWorkflow', …)`.
 * const picked = extractAslFromTemplate({ resourceId: 'OrderWorkflow', template: cdkSynthJson });
 * // picked.resourceId === 'OrderWorkflow0015CDD9'
 * // Read a SAM DefinitionUri file relative to the template.
 * const sam = extractAslFromTemplate({
 *     readFile: ({ path }) => readFileSync(join(dirname(templatePath), path), 'utf-8'),
 *     template: readFileSync(templatePath, 'utf-8'),
 * });
 * // Pass templateFileName too ('cdk.out/OrdersStack.template.json') to read a CDK asset.
 * ```
 */
export function extractAslFromTemplate(params: ExtractAslFromTemplateParams): ExtractAslResult {
    const { format = 'auto', readFile, resourceId, template, templateFileName } = params;

    const parsed = parseTemplate({ format, template });
    const resources = (parsed.Resources ?? {}) as Record<string, CfnResource>;
    const machines = findStateMachines(resources);

    if (machines.length === 0) {
        throw new Error(`Template contains no ${STATE_MACHINE_TYPE_LIST} resource.`);
    }
    const labels = (): string =>
        machines.map((machine) => formatMachineLabel({ machine })).join(', ');

    let chosenId: string;
    if (resourceId) {
        const chosen = matchStateMachine({ machines, resourceId });
        if (chosen === undefined) {
            throw new Error(
                `Resource '${resourceId}' is not a state machine (${STATE_MACHINE_TYPE_LIST}). Found: ${labels()}.`,
            );
        }
        chosenId = chosen.logicalId;
    } else if (machines.length === 1) {
        chosenId = machines[0].logicalId;
    } else {
        throw new Error(
            `Template has multiple state machines: ${labels()}. ` +
                `Pass resourceId (or --resource) to choose one.`,
        );
    }

    const properties = resources[chosenId].Properties ?? {};
    const { substitutions, warnings: substitutionWarnings } = resolveSubstitutions({
        value: properties.DefinitionSubstitutions,
    });
    const externalKey = EXTERNAL_DEFINITION_KEYS.find((key) => key in properties);
    if (externalKey && !('DefinitionString' in properties) && !('Definition' in properties)) {
        const location = properties[externalKey];
        const where = typeof location === 'string' ? ` ('${location}')` : '';
        const diagnostic =
            `State machine '${chosenId}' loads its definition from ${externalKey}${where}, ` +
            `which cannot be read from the template alone. ` +
            `Render that ASL file directly (download it first if it is in S3), or inline the definition in the template.`;
        if (
            readFile !== undefined &&
            externalKey === 'DefinitionUri' &&
            typeof location === 'string' &&
            location !== '' &&
            !/^s3:\/\//i.test(location)
        ) {
            // Checked on the template's own value, before any file access: on Windows a path
            // starting with two separators is a UNC path, and touching it opens an SMB
            // connection to a host the template picked.
            if (/^[\\/]{2}/.test(location)) {
                throw new Error(
                    `State machine '${chosenId}' loads its definition from DefinitionUri ('${location}'), ` +
                        `which is a network or device path; only local files are read. Render that ASL file directly.`,
                );
            }
            const aslDefinition = readDefinitionUri({
                location,
                logicalId: chosenId,
                readFile,
                substitutions,
            });
            return { aslDefinition, resourceId: chosenId, warnings: substitutionWarnings };
        }
        const manifestName =
            templateFileName === undefined ? undefined : assetManifestName({ templateFileName });
        if (
            readFile !== undefined &&
            externalKey === 'DefinitionS3Location' &&
            manifestName !== undefined &&
            isPlainObject(location) &&
            typeof location.Key === 'string' &&
            isCdkAssetKey({ objectKey: location.Key })
        ) {
            const aslDefinition = readCdkAsset({
                diagnostic,
                logicalId: chosenId,
                manifestName,
                objectKey: location.Key,
                readFile,
                substitutions,
            });
            return { aslDefinition, resourceId: chosenId, warnings: substitutionWarnings };
        }
        throw new Error(diagnostic);
    }

    const rawDefinition = properties.DefinitionString ?? properties.Definition;
    if (rawDefinition === undefined) {
        throw new Error(`State machine '${chosenId}' has no DefinitionString or Definition.`);
    }

    // Substitute before parsing: a string definition is filled as raw text (as CloudFormation
    // does), so an unquoted `"Seconds":${Wait}` is still valid JSON by the time it is parsed.
    const { value: resolved, warnings } = resolveIntrinsics({ value: rawDefinition });
    const substituted = applySubstitutions({ substitutions, value: resolved });
    const aslDefinition = parseAslSource({ source: substituted as AslDefinition | string });

    return { aslDefinition, resourceId: chosenId, warnings: [...substitutionWarnings, ...warnings] };
}
