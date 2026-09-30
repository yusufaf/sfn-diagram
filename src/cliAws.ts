/**
 * @module
 *
 * Node-only AWS support for the `sfn-diagram` CLI's `--from-aws` flag.
 *
 * `@aws-sdk/client-sfn` is an optional peer dependency and is loaded here with a
 * dynamic import, so neither the core entry nor the bundled `dist/bin.js` carries
 * AWS code: an install that never renders a live state machine never pays for the
 * SDK. ARN parsing is deliberately kept separate from the fetch, and synchronous,
 * so a malformed ARN is a usage error reported before any client is constructed.
 */

/** Raised for an ARN the CLI cannot use, or an AWS call it could not complete. */
export class CliAwsError extends Error {}

/** A state machine ARN broken into the parts the CLI needs. */
export interface ParsedStateMachineArn {
    /** The ARN exactly as given, for messages and for the API call. */
    arn: string;
    /** The state machine name — used to derive an output filename under `--out-dir`. */
    name: string;
    /** The version number or alias after the name, or `null` when absent. */
    qualifier: string | null;
    /** The region the SFN client is constructed for. */
    region: string;
}

/** The ARN shape quoted back in every rejection, so the message is self-describing. */
const ARN_SHAPE = 'arn:aws:states:<region>:<account>:stateMachine:<name>';

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
 *   quoting the value and the shape expected. Callers map this to exit 2.
 *
 * @example
 * ```typescript
 * parseStateMachineArn({
 *     value: 'arn:aws:states:us-east-1:123456789012:stateMachine:Orders',
 * });
 * // { arn: 'arn:…:Orders', name: 'Orders', qualifier: null, region: 'us-east-1' }
 * ```
 */
export function parseStateMachineArn(
    params: ParseStateMachineArnParams,
): ParsedStateMachineArn {
    const { value } = params;
    const segments = value.split(':');
    const [prefix, partition, service, region, , resourceType, name] = segments;

    const reject = (): never => {
        throw new CliAwsError(
            `--from-aws expects a state machine ARN (${ARN_SHAPE}); got ${JSON.stringify(value)}`,
        );
    };

    // 7 segments is an unqualified ARN, 8 adds a version or alias. The account
    // segment is the one field never read, so it is the only one left unchecked:
    // an empty account is AWS's business to reject, not ours.
    if (segments.length < 7 || segments.length > 8) reject();
    if (prefix !== 'arn' || service !== 'states') reject();
    if (resourceType !== 'stateMachine') reject();
    if (!partition || !region || !name) reject();

    return {
        arn: value,
        name,
        qualifier: segments.length === 8 ? segments[7] : null,
        region,
    };
}
