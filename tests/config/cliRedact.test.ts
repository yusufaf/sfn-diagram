import { describe, expect, it } from 'vitest';
import { buildCliRedact } from '../../src/cliRedact';
import { REDACTED, redactStateData } from '../../src/redact';
import { collectStateData } from '../../src/renderers/viewer/stateData';
import type { AslDefinition, AslState, RedactCallback } from '../../src/types';

const SECRET = 'sk-live-0123456789';

const definition = {
    StartAt: 'Fetch',
    States: {
        Fetch: {
            Next: 'Fan',
            Parameters: { FunctionName: 'fetch', Token: SECRET },
            Resource: 'arn:aws:states:::lambda:invoke',
            Type: 'Task',
        },
        Fan: {
            Branches: [
                {
                    StartAt: 'Inner',
                    States: {
                        Inner: {
                            End: true,
                            Parameters: { Token: SECRET },
                            Resource: 'arn:aws:states:::lambda:invoke',
                            Type: 'Task',
                        },
                    },
                },
            ],
            Next: 'Shape',
            Type: 'Parallel',
        },
        Shape: {
            Next: 'Call',
            Parameters: { 'Payload.$': '$.secret', Static: 'kept' },
            Type: 'Pass',
        },
        Call: {
            Arguments: { Token: SECRET },
            End: true,
            QueryLanguage: 'JSONata',
            Resource: 'arn:aws:states:::lambda:invoke',
            Type: 'Task',
        },
    },
} as unknown as AslDefinition;

/** Parameters for {@link redactWith}. */
interface RedactWithParams {
    /** The ASL to collect and redact; the shared fixture when omitted. */
    asl?: AslDefinition;
    /** The hook under test. */
    redact: RedactCallback | undefined;
}

/** Collect a definition's state data and run it through the hook, as the HTML sink does. */
function redactWith(
    params: RedactWithParams,
): Record<string, Record<string, unknown>> {
    const { asl = definition, redact } = params;
    return redactStateData({
        redact,
        stateData: collectStateData({ definition: asl }),
    }) as Record<string, Record<string, unknown>>;
}

/** Look up a node id by state name, since nested states get scoped ids. */
function idOf(stateData: Record<string, unknown>, name: string): string {
    const id = Object.keys(stateData).find(
        (key) => key === name || key.endsWith(name),
    );
    if (id === undefined) throw new Error(`no state data for ${name}`);
    return id;
}

describe('buildCliRedact', () => {
    it('returns no hook when nothing is to be redacted', () => {
        expect(
            buildCliRedact({ fields: [], includeRawState: true }),
        ).toBeUndefined();
    });

    it('redacts a named field and keeps the rest of the state', () => {
        const data = redactWith({
            redact: buildCliRedact({
                fields: ['Parameters'],
                includeRawState: true,
            }),
        });
        expect(data.Fetch.Parameters).toBe(REDACTED);
        expect(data.Fetch.Resource).toBe('arn:aws:states:::lambda:invoke');
        expect((data.Call.Arguments as Record<string, unknown>).Token).toBe(
            SECRET,
        );
    });

    it('keeps non-matching fields equal to the input', () => {
        const stateData = collectStateData({ definition });
        const data = redactWith({
            redact: buildCliRedact({
                fields: ['Parameters'],
                includeRawState: true,
            }),
        });
        const fetch = stateData.Fetch as AslState & Record<string, unknown>;
        expect(data.Fetch.Type).toEqual(fetch.Type);
        expect(data.Fetch.Resource).toEqual(fetch.Resource);
        expect(data.Fetch.Next).toEqual(fetch.Next);
    });

    it('catches a nested state both in its own entry and in its container copy', () => {
        const data = redactWith({
            redact: buildCliRedact({
                fields: ['Parameters'],
                includeRawState: true,
            }),
        });
        const branches = data.Fan.Branches as Array<{
            States: Record<string, Record<string, unknown>>;
        }>;
        expect(branches[0].States.Inner.Parameters).toBe(REDACTED);
        expect(data[idOf(data, 'Inner')].Parameters).toBe(REDACTED);
        expect(JSON.stringify({ ...data, Call: undefined })).not.toContain(
            SECRET,
        );
    });

    it('matches the dynamic .$ form of a field name', () => {
        const data = redactWith({
            redact: buildCliRedact({
                fields: ['Payload'],
                includeRawState: true,
            }),
        });
        const parameters = data.Shape.Parameters as Record<string, unknown>;
        expect(parameters['Payload.$']).toBe(REDACTED);
        expect(parameters.Static).toBe('kept');
    });

    it('treats a dotted name as a nested key', () => {
        const data = redactWith({
            redact: buildCliRedact({
                fields: ['Parameters.Token'],
                includeRawState: true,
            }),
        });
        const parameters = data.Fetch.Parameters as Record<string, unknown>;
        expect(parameters.Token).toBe(REDACTED);
        expect(parameters.FunctionName).toBe('fetch');
    });

    it('is case-sensitive', () => {
        const data = redactWith({
            redact: buildCliRedact({
                fields: ['parameters'],
                includeRawState: true,
            }),
        });
        expect((data.Fetch.Parameters as Record<string, unknown>).Token).toBe(
            SECRET,
        );
    });

    it('never matches a state id against a field name', () => {
        const asl = {
            StartAt: 'Parameters',
            States: {
                Parameters: {
                    End: true,
                    Parameters: { Token: SECRET },
                    Type: 'Pass',
                },
            },
        } as unknown as AslDefinition;
        const data = redactWith({
            asl,
            redact: buildCliRedact({
                fields: ['Parameters'],
                includeRawState: true,
            }),
        });
        expect(data.Parameters).toEqual({
            End: true,
            Parameters: REDACTED,
            Type: 'Pass',
        });
    });

    it('redacts a nested state named after a field inside its container copy', () => {
        const asl = {
            StartAt: 'Fan',
            States: {
                Fan: {
                    Branches: [
                        {
                            StartAt: 'Parameters',
                            States: {
                                Parameters: { End: true, Type: 'Pass' },
                            },
                        },
                    ],
                    End: true,
                    Type: 'Parallel',
                },
            },
        } as unknown as AslDefinition;
        const data = redactWith({
            asl,
            redact: buildCliRedact({
                fields: ['Parameters'],
                includeRawState: true,
            }),
        });
        const branches = data.Fan.Branches as Array<{
            States: Record<string, unknown>;
        }>;
        expect(branches[0].States.Parameters).toBe(REDACTED);
        expect(data[idOf(data, 'Parameters')]).toEqual({
            End: true,
            Type: 'Pass',
        });
    });

    it('names an array item by index, not by a dotted key', () => {
        const asl = {
            StartAt: 'Try',
            States: {
                Try: {
                    Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Done' }],
                    Next: 'Done',
                    Type: 'Pass',
                },
                Done: { End: true, Type: 'Succeed' },
            },
        } as unknown as AslDefinition;
        const dotted = redactWith({
            asl,
            redact: buildCliRedact({
                fields: ['Catch.Next'],
                includeRawState: true,
            }),
        });
        expect(dotted.Try).toEqual(asl.States.Try);

        const indexed = redactWith({
            asl,
            redact: buildCliRedact({
                fields: ['Catch[0].Next'],
                includeRawState: true,
            }),
        });
        const catchers = indexed.Try.Catch as Array<Record<string, unknown>>;
        expect(catchers[0].Next).toBe(REDACTED);
        expect(indexed.Try.Next).toBe('Done');
    });

    it('redacts every state whole without raw state', () => {
        const data = redactWith({
            redact: buildCliRedact({ fields: [], includeRawState: false }),
        });
        expect(Object.values(data).length).toBeGreaterThan(0);
        for (const entry of Object.values(data)) expect(entry).toBe(REDACTED);
    });

    it('passes payloads through', () => {
        const hook = buildCliRedact({
            fields: ['error'],
            includeRawState: false,
        });
        expect(
            hook?.({
                kind: 'payload',
                path: 'Fetch.error',
                stateId: 'Fetch',
                value: 'States.TaskFailed',
            }),
        ).toBe('States.TaskFailed');
    });
});
