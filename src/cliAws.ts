/**
 * @module
 *
 * Node-only AWS support for the `sfn-diagram` CLI's `--from-aws` flag and its
 * `--execution <arn>` / `--follow` live mode.
 *
 * `@aws-sdk/client-sfn` is an optional peer dependency and is loaded here with a
 * dynamic import, so neither the core entry nor the bundled `dist/bin.js` carries
 * AWS code: an install that never renders a live state machine never pays for the
 * SDK. ARN parsing is deliberately kept separate from the fetch, and synchronous,
 * so a malformed ARN is a usage error reported before any client is constructed.
 */

import { loadOptionalPeer } from './exporters/loadOptionalPeer';
import type {
    DescribeStateMachineCommandOutput,
    HistoryEvent,
    SFNClient,
} from '@aws-sdk/client-sfn';

/** Raised for an ARN the CLI cannot use, or an AWS call it could not complete. */
export class CliAwsError extends Error {}

/** A state machine ARN broken into the parts the CLI needs. */
export interface ParsedStateMachineArn {
    /** The ARN exactly as given, for messages and for the API call. */
    arn: string;
    /** The state machine name, without any version or alias qualifier. */
    name: string;
    /**
     * The stem an output filename is derived from under `--out-dir`: the name, with
     * any qualifier appended after a hyphen. A machine and its own alias are
     * different definitions and comparing them is what qualifier support is for, so
     * they must not both want `Orders.svg`.
     */
    outputName: string;
    /** The version number or alias after the name, or `null` when absent. */
    qualifier: string | null;
    /** The region the SFN client is constructed for. */
    region: string;
}

/** The state machine ARN shape quoted back in a rejection, so it is self-describing. */
const STATE_MACHINE_ARN_SHAPE =
    'arn:aws:states:<region>:<account>:stateMachine:<name>';

/** The execution ARN shape, quoted the same way. */
const EXECUTION_ARN_SHAPE =
    'arn:aws:states:<region>:<account>:execution:<state-machine>:<execution>';

/** Parameters for {@link rejectArn}. */
interface RejectArnParams {
    /** Appended after the shape, for a rejection that has more to say. */
    detail?: string;
    /** What the ARN should have looked like. */
    expected: string;
    /** The flag the value came from, named first so the reader knows what to fix. */
    flag: string;
    /** The value as given, quoted back. */
    value: string;
}

/**
 * Throw the one rejection shape both ARN parsers use.
 *
 * @param params - The flag, the value, the expected shape and any extra detail.
 *
 * @returns Never; it always throws.
 *
 * @throws {CliAwsError} Always.
 */
function rejectArn(params: RejectArnParams): never {
    const { detail = '', expected, flag, value } = params;
    const noun = expected === EXECUTION_ARN_SHAPE ? 'an execution' : 'a state machine';
    throw new CliAwsError(
        `${flag} expects ${noun} ARN (${expected}); got ${JSON.stringify(value)}${detail}`,
    );
}

/**
 * Whether a CLI value is meant as an AWS ARN rather than a file path.
 *
 * Deliberately loose: it claims anything beginning `arn:` so that a malformed ARN
 * is rejected by {@link parseStateMachineArn}'s specific message instead of being
 * read as a filename and reported as a missing file. No path on any platform
 * begins with `arn:` — a Windows drive letter is a single character.
 *
 * @param value - A raw command-line value.
 *
 * @returns `true` when the value should be parsed as an ARN.
 *
 * @example
 * ```typescript
 * isStateMachineArn('arn:aws:states:us-east-1:1:stateMachine:A'); // true
 * isStateMachineArn('machines/a.asl.json');                       // false
 * ```
 */
export function isStateMachineArn(value: string): boolean {
    return value.startsWith('arn:');
}

/** Parameters for {@link parseStateMachineArn}. */
export interface ParseStateMachineArnParams {
    /**
     * The flag the value came from, named at the start of a rejection. Defaults to
     * `'--from-aws'`. `--diff` accepts an ARN too, and telling its user about
     * `--from-aws` would send them to the wrong flag.
     */
    flag?: string;
    /** The raw `--from-aws` (or `--diff`) value. */
    value: string;
}

/**
 * Split a Step Functions state machine ARN into the region the client needs and
 * the name an output file is derived from.
 *
 * A trailing version number or alias is accepted — `DescribeStateMachine` takes a
 * state machine, version or alias ARN, so refusing one would be a gratuitous
 * limitation. A bare state machine name is refused: resolving one would need a
 * second `ListStateMachines` call and a region flag.
 *
 * @param params - The raw value to parse.
 *
 * @returns The ARN's region, name and optional qualifier.
 *
 * @throws {CliAwsError} When the value is not a Step Functions state machine ARN,
 *   naming the flag it came from and quoting the value and the shape expected.
 *   Callers map this to exit 2.
 *
 * @example
 * ```typescript
 * parseStateMachineArn({
 *     value: 'arn:aws:states:us-east-1:123456789012:stateMachine:Orders',
 * });
 * // { arn: 'arn:…:Orders', name: 'Orders', outputName: 'Orders',
 * //   qualifier: null, region: 'us-east-1' }
 * ```
 */
export function parseStateMachineArn(
    params: ParseStateMachineArnParams,
): ParsedStateMachineArn {
    const { flag = '--from-aws', value } = params;
    const segments = value.split(':');
    const [prefix, partition, service, region, , resourceType, name] = segments;

    const reject = (): never =>
        rejectArn({ expected: STATE_MACHINE_ARN_SHAPE, flag, value });

    // 7 segments is an unqualified ARN, 8 adds a version or alias. The account
    // segment is the one field never read, so it is the only one left unchecked:
    // an empty account is AWS's business to reject, not ours.
    if (segments.length < 7 || segments.length > 8) reject();
    if (prefix !== 'arn' || service !== 'states') reject();
    if (resourceType !== 'stateMachine') reject();
    if (!partition || !region || !name) reject();
    // A trailing colon is a typo, not a qualifier. Read as one it produced an empty
    // string, which then hyphenated an output filename into `Orders-`.
    const qualifier = segments.length === 8 ? segments[7] : null;
    if (qualifier === '') reject();

    return {
        arn: value,
        name,
        outputName: qualifier === null ? name : `${name}-${qualifier}`,
        qualifier,
        region,
    };
}

/**
 * The subset of `@aws-sdk/client-sfn` this module uses, so the dynamic import's
 * result can be typed without a static dependency on the package's shape.
 */
interface SfnModule {
    DescribeStateMachineCommand: new (input: {
        stateMachineArn: string;
    }) => object;
    SFNClient: new (config: { region: string }) => SFNClient;
}

/** Error names and message fragments that mean "no usable credentials". */
const CREDENTIAL_FAILURE_MARKERS = [
    'CredentialsProviderError',
    'Could not load credentials',
];

/** Appended to a credentials failure, and to nothing else. */
const CREDENTIALS_HINT =
    '\nSet AWS_PROFILE / AWS_REGION, or configure the AWS CLI (aws configure).';

/** Parameters for {@link loadSfnModule}. */
interface LoadSfnModuleParams {
    /**
     * The flag that needed the SDK, named in the "install this" error.
     *
     * Three flags reach the SDK through this one loader, so a hardcoded name told a
     * `--execution <arn>` or `--diff <arn>` user to install a peer for `--from-aws`,
     * which they never typed. The message is the one part of a shared policy that
     * must not be shared.
     */
    flag: string;
}

/**
 * Load `@aws-sdk/client-sfn`, or fail with an actionable install command.
 *
 * @param params - The flag that needed it.
 *
 * @returns The subset of the SDK this module uses.
 *
 * @throws {CliAwsError} When the optional peer is not installed.
 */
async function loadSfnModule(params: LoadSfnModuleParams): Promise<SfnModule> {
    try {
        return await loadOptionalPeer<SfnModule>({
            feature: params.flag,
            load: async () =>
                (await import('@aws-sdk/client-sfn')) as unknown as SfnModule,
            packageName: '@aws-sdk/client-sfn',
        });
    } catch (error) {
        throw new CliAwsError(
            error instanceof Error ? error.message : String(error),
            { cause: error },
        );
    }
}

/** Parameters for {@link describeAwsFailure}. */
interface DescribeAwsFailureParams {
    /** The ARN the call was about, so the message says which resource. */
    arn: string;
    /** Whatever the SDK threw. */
    error: unknown;
}

/**
 * One sentence for any failed AWS call, with the credentials pointer appended only
 * when credentials were the problem.
 *
 * Shared by both fetches so a throttled call and a missing role read the same way,
 * and so a not-found error is never told to run `aws configure`.
 *
 * @param params - The ARN and the thrown error.
 *
 * @returns The message to put in a {@link CliAwsError}.
 */
function describeAwsFailure(params: DescribeAwsFailureParams): string {
    const { arn, error } = params;
    const reason = error instanceof Error ? error.message : String(error);
    const name = error instanceof Error ? error.name : '';
    const isCredentialFailure = CREDENTIAL_FAILURE_MARKERS.some(
        (marker) => name === marker || reason.includes(marker),
    );
    return (
        `Failed to fetch ${arn} from AWS: ${reason}` +
        (isCredentialFailure ? CREDENTIALS_HINT : '')
    );
}

/** Parameters for {@link fetchStateMachineDefinition}. */
export interface FetchStateMachineDefinitionParams {
    /**
     * The already-parsed ARN. Callers parse first so that a malformed ARN is a
     * usage error reported before any client is constructed or peer loaded.
     */
    arn: ParsedStateMachineArn;
    /**
     * The flag that asked for this, named if the optional peer is missing. Both
     * `--from-aws` and an ARN `--diff` baseline come through here.
     */
    flag: string;
}

/**
 * Fetch a live state machine's ASL definition with `DescribeStateMachine`.
 *
 * `@aws-sdk/client-sfn` is loaded with a dynamic import so that neither the core
 * entry nor `dist/bin.js` carries AWS code: an install that never uses
 * `--from-aws` never pays for the SDK. The definition is returned as the JSON
 * string AWS sends, unparsed, because that is what `resolveDefinitionSource`
 * already accepts.
 *
 * @param params - The parsed ARN to describe.
 *
 * @returns The state machine's ASL definition, as a JSON string.
 *
 * @throws {CliAwsError} When the optional peer is missing, the API call fails
 *   (credentials, permissions, not found, throttling, network), or a successful
 *   response carries no definition. Callers map this to exit 1.
 *
 * @example
 * ```typescript
 * const arn = parseStateMachineArn({ value: process.argv[2] });
 * const definition = await fetchStateMachineDefinition({ arn, flag: '--from-aws' });
 * ```
 */
export async function fetchStateMachineDefinition(
    params: FetchStateMachineDefinitionParams,
): Promise<string> {
    const { arn, flag } = params;

    const sfn = await loadSfnModule({ flag });

    let response: DescribeStateMachineCommandOutput;
    try {
        const client = new sfn.SFNClient({ region: arn.region });
        response = (await client.send(
            new sfn.DescribeStateMachineCommand({
                stateMachineArn: arn.arn,
            }) as Parameters<SFNClient['send']>[0],
        )) as DescribeStateMachineCommandOutput;
    } catch (error) {
        throw new CliAwsError(
            describeAwsFailure({ arn: `state machine ${arn.arn}`, error }),
            { cause: error },
        );
    }

    if (response.definition === undefined) {
        throw new CliAwsError(
            `AWS returned no definition for ${arn.arn}. ` +
                'DescribeStateMachine succeeded but the response was empty.',
        );
    }
    return response.definition;
}

/** An execution ARN broken into the parts the CLI needs. */
export interface ParsedExecutionArn {
    /** The ARN exactly as given, for messages and for the API call. */
    arn: string;
    /** The execution's own name — the last segment. */
    executionName: string;
    /**
     * The stem an output filename is derived from: the state machine name and the
     * execution name joined by a hyphen, so two runs of one machine do not collide.
     */
    outputName: string;
    /** The region the SFN client is constructed for. */
    region: string;
    /** The state machine the execution belongs to. */
    stateMachineName: string;
}

/** Parameters for {@link parseExecutionArn}. */
export interface ParseExecutionArnParams {
    /**
     * The flag the value came from, named at the start of a rejection. Defaults to
     * `'--execution'`, the only flag that takes one today.
     */
    flag?: string;
    /** The raw `--execution` value. */
    value: string;
}

/**
 * Split a Step Functions execution ARN into the region and the two names the CLI
 * needs.
 *
 * Express workflow ARNs (`…:express:…`) are refused with their own message:
 * `GetExecutionHistory` does not serve Express executions at all, so accepting the
 * ARN would only move the failure to the API call and report it as a runtime error
 * rather than a usage one.
 *
 * @param params - The raw value to parse.
 *
 * @returns The ARN's region, state machine name and execution name.
 *
 * @throws {CliAwsError} When the value is not a standard execution ARN, naming the
 *   flag it came from and quoting the value and the shape expected. Callers map this
 *   to exit 2.
 *
 * @example
 * ```typescript
 * parseExecutionArn({
 *     value: 'arn:aws:states:us-east-1:123456789012:execution:Orders:run-1',
 * });
 * // { arn: 'arn:…:run-1', executionName: 'run-1', outputName: 'Orders-run-1',
 * //   region: 'us-east-1', stateMachineName: 'Orders' }
 * ```
 */
export function parseExecutionArn(
    params: ParseExecutionArnParams,
): ParsedExecutionArn {
    const { flag = '--execution', value } = params;
    const segments = value.split(':');
    const [prefix, partition, service, region, , resourceType, stateMachineName, executionName] =
        segments;

    const reject = (detail?: string): never =>
        rejectArn({ detail, expected: EXECUTION_ARN_SHAPE, flag, value });

    if (resourceType === 'express') {
        reject(
            '. Express workflow executions have no retrievable history: ' +
                'GetExecutionHistory serves Standard workflows only.',
        );
    }
    if (segments.length !== 8) reject();
    if (prefix !== 'arn' || service !== 'states') reject();
    if (resourceType !== 'execution') reject();
    if (!partition || !region || !stateMachineName || !executionName) reject();

    return {
        arn: value,
        executionName,
        outputName: `${stateMachineName}-${executionName}`,
        region,
        stateMachineName,
    };
}

/** Parameters for {@link createSfnClient}. */
export interface CreateSfnClientParams {
    /** The flag that needed the SDK, named if the optional peer is missing. */
    flag: string;
    /** Region the client talks to, taken from the ARN. */
    region: string;
}

/**
 * Build one SFN client, loading the optional peer on the way.
 *
 * Exposed so a caller that will make many calls — the `--follow` poll loop — builds
 * one client and reuses it. Each client carries its own keep-alive HTTP agent, so one
 * per call means no connection is ever reused and discarded agents' idle sockets
 * accumulate for the life of the process.
 *
 * @param params - The region and the flag that needed it.
 *
 * @returns A client ready to `send` commands.
 *
 * @throws {CliAwsError} When the optional peer is not installed.
 *
 * @example
 * ```typescript
 * const client = await createSfnClient({ flag: '--execution', region: arn.region });
 * ```
 */
export async function createSfnClient(
    params: CreateSfnClientParams,
): Promise<SFNClient> {
    const { flag, region } = params;
    const sfn = await loadSfnModule({ flag });
    return new sfn.SFNClient({ region });
}

/** Parameters for {@link fetchExecutionHistoryForArn}. */
export interface FetchExecutionHistoryForArnParams {
    /**
     * The already-parsed ARN. Callers parse first so that a malformed ARN is a usage
     * error reported before any client is constructed or peer loaded.
     */
    arn: ParsedExecutionArn;
    /**
     * A client to reuse. Omit it for a one-off fetch and one is built here; a poll
     * loop passes the same client every tick so the connection is reused.
     */
    client?: SFNClient;
    /** The flag that asked for this, named if the optional peer is missing. */
    flag?: string;
}

/**
 * Fetch an execution's complete history, following every `nextToken` page.
 *
 * Both the SDK and `sfn-diagram/aws`'s own `fetchExecutionHistory` are loaded with
 * dynamic imports for the same reason `fetchStateMachineDefinition` does it: the
 * core entry and `dist/bin.js` must not carry AWS code for an install that never
 * asks for it. `src/aws.ts` imports the SDK statically, so it can only be reached
 * this way.
 *
 * @param params - The parsed execution ARN.
 *
 * @returns Every history event, in chronological order.
 *
 * @throws {CliAwsError} When the optional peer is missing or the API call fails
 *   (credentials, permissions, no such execution, throttling, network). Callers map
 *   this to exit 1.
 *
 * @example
 * ```typescript
 * const arn = parseExecutionArn({ value: process.argv[2] });
 * const events = await fetchExecutionHistoryForArn({ arn });
 * ```
 */
export async function fetchExecutionHistoryForArn(
    params: FetchExecutionHistoryForArnParams,
): Promise<HistoryEvent[]> {
    const { arn, client, flag = '--execution' } = params;

    const resolvedClient =
        client ?? (await createSfnClient({ flag, region: arn.region }));
    try {
        const { fetchExecutionHistory } = await import('./aws');
        return await fetchExecutionHistory({
            client: resolvedClient,
            executionArn: arn.arn,
        });
    } catch (error) {
        throw new CliAwsError(
            describeAwsFailure({
                arn: `execution history for ${arn.arn}`,
                error,
            }),
            {
                cause: error,
            },
        );
    }
}
