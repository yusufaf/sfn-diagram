import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import {
    buildExecutionTimeline,
    generateHtml,
    generateViewerUpdate,
    REDACTED,
    redactPayloadText,
    redactStateData,
} from '../src';
import type { AslDefinition, AslState, RedactCallback } from '../src/types';

/**
 * Redaction of the data a generated document inlines beyond the drawn diagram: the
 * raw ASL in `#sfn-state-data` and the execution payloads on `#sfn-timeline-data`.
 *
 * The hook is only worth anything if it covers every path into those two blobs, so
 * the integration half below drives each entry point that fills them rather than
 * trusting that they share a code path.
 */

const SECRET = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:prod-token';

const definition: AslDefinition = {
    StartAt: 'Fetch',
    States: {
        Fetch: {
            Type: 'Task',
            Resource: 'arn:aws:states:::lambda:invoke',
            Parameters: { FunctionName: 'fetch', Payload: { token: SECRET } },
            Retry: [{ ErrorEquals: ['States.TaskFailed'], MaxAttempts: 3 }],
            Next: 'Fan',
        },
        Fan: {
            Type: 'Parallel',
            Branches: [
                {
                    StartAt: 'Inner',
                    States: {
                        Inner: { Type: 'Task', Resource: 'arn:inner', Parameters: { key: SECRET }, End: true },
                    },
                },
            ],
            Next: 'Done',
        },
        Done: { Type: 'Succeed' },
    },
};

/** A hook that drops every `Parameters` block, wherever it sits. */
const dropParameters: RedactCallback = ({ path, value }) =>
    path.endsWith('.Parameters') ? undefined : value;

/** The parsed `#sfn-state-data` blob of a generated document. */
function stateBlob(html: string): Record<string, AslState> {
    const match = /<script type="application\/json" id="sfn-state-data">([\s\S]*?)<\/script>/.exec(html);
    if (!match) throw new Error('no #sfn-state-data blob in the document');
    return JSON.parse(match[1]) as Record<string, AslState>;
}

/** The parsed `#sfn-timeline-data` blob of a generated document. */
function timelineBlob(html: string): { entries: Array<Record<string, unknown>> } {
    const match = /<script type="application\/json" id="sfn-timeline-data">([\s\S]*?)<\/script>/.exec(html);
    if (!match) throw new Error('no #sfn-timeline-data blob in the document');
    return JSON.parse(match[1]) as { entries: Array<Record<string, unknown>> };
}

/** The retry fixture with payloads attached, one of them well past the 4096 cap. */
function historyWithPayloads(): { events: unknown[] } {
    const events = JSON.parse(
        readFileSync(join(__dirname, 'fixtures', 'execution-retry-success.json'), 'utf-8'),
    ).events;
    events[1].stateEnteredEventDetails.input = `{"token":"${SECRET}"}`;
    events[4].taskFailedEventDetails.cause = `connection reset: ${SECRET}`;
    events[11].stateExitedEventDetails.output = '{"receipt":"' + 'x'.repeat(6000) + '"}';
    return { events };
}

const retryDefinition: AslDefinition = {
    StartAt: 'Submit',
    States: {
        Submit: {
            Type: 'Task',
            Resource: 'arn:aws:lambda:us-east-1:123456789012:function:submit',
            Retry: [{ ErrorEquals: ['States.Timeout'], MaxAttempts: 3 }],
            Next: 'Done',
        },
        Done: { Type: 'Succeed' },
    },
};

describe('redactStateData', () => {
    it('hands back the same record untouched when no hook was given', () => {
        const stateData = { Fetch: definition.States.Fetch };
        expect(redactStateData({ stateData })).toBe(stateData);
    });

    it('replaces a redacted field with the placeholder and leaves its siblings alone', () => {
        const redacted = redactStateData({
            redact: dropParameters,
            stateData: { Fetch: definition.States.Fetch },
        });

        expect(redacted.Fetch.Parameters).toBe(REDACTED);
        expect(redacted.Fetch.Type).toBe('Task');
        expect(redacted.Fetch.Resource).toBe('arn:aws:states:::lambda:invoke');
        expect(JSON.stringify(redacted)).not.toContain(SECRET);
    });

    it('never mutates the caller\'s own definition', () => {
        redactStateData({ redact: dropParameters, stateData: { Fetch: definition.States.Fetch } });
        expect(definition.States.Fetch.Parameters).toEqual({
            FunctionName: 'fetch',
            Payload: { token: SECRET },
        });
    });

    it('offers each state whole first, so one answer can drop all of it', () => {
        const redacted = redactStateData({
            redact: ({ path, value }) => (path === 'Fetch' ? undefined : value),
            stateData: { Done: definition.States.Done, Fetch: definition.States.Fetch },
        });

        expect(redacted.Fetch).toBe(REDACTED);
        expect(redacted.Done).toEqual({ Type: 'Succeed' });
    });

    it('walks into arrays, numbering them in the path', () => {
        const seen: string[] = [];
        redactStateData({
            redact: ({ path, value }) => {
                seen.push(path);
                return value;
            },
            stateData: { Fetch: definition.States.Fetch },
        });

        expect(seen).toContain('Fetch.Retry[0].MaxAttempts');
        expect(seen).toContain('Fetch.Parameters.Payload.token');
    });

    it('stops walking at a value the hook replaced', () => {
        const seen: string[] = [];
        const redacted = redactStateData({
            redact: ({ path, value }) => {
                seen.push(path);
                return path === 'Fetch.Parameters' ? { FunctionName: 'fetch' } : value;
            },
            stateData: { Fetch: definition.States.Fetch },
        });

        expect(redacted.Fetch.Parameters).toEqual({ FunctionName: 'fetch' });
        expect(seen).not.toContain('Fetch.Parameters.Payload');
    });

    it('reports the state each value belongs to, including inside a Parallel branch', () => {
        const byStateId = new Map<string, string[]>();
        const stateData = {
            Fan: definition.States.Fan,
            'Fan.0.Inner': (definition.States.Fan.Branches as AslDefinition[])[0].States.Inner,
        };
        redactStateData({
            redact: ({ path, stateId, value }) => {
                byStateId.set(stateId!, [...(byStateId.get(stateId!) ?? []), path]);
                return value;
            },
            stateData,
        });

        expect(byStateId.get('Fan.0.Inner')).toContain('Fan.0.Inner.Parameters.key');
        expect(byStateId.get('Fan')).toBeDefined();
        expect(byStateId.get('Fan')!.every((path) => path.startsWith('Fan'))).toBe(true);
    });

    it('always reports kind: state', () => {
        const kinds = new Set<string>();
        redactStateData({
            redact: ({ kind, value }) => {
                kinds.add(kind);
                return value;
            },
            stateData: { Fetch: definition.States.Fetch },
        });
        expect([...kinds]).toEqual(['state']);
    });
});

describe('redactPayloadText', () => {
    it('returns the text unchanged with no hook', () => {
        expect(redactPayloadText({ field: 'input', text: '{"a":1}' })).toBe('{"a":1}');
    });

    it('redacts to the placeholder, substitutes a returned string, and keeps the argument', () => {
        const call = (redact: RedactCallback): string =>
            redactPayloadText({ field: 'input', redact, stateId: 'Submit', text: 'raw' });

        expect(call(() => undefined)).toBe(REDACTED);
        expect(call(() => 'scrubbed')).toBe('scrubbed');
        expect(call(({ value }) => value)).toBe('raw');
    });

    it('falls back to the placeholder when a hook returns something that is not text', () => {
        expect(
            redactPayloadText({ field: 'output', redact: () => ({ nope: true }), text: 'raw' }),
        ).toBe(REDACTED);
    });

    it('paths a state payload by its id and the execution cause by "execution"', () => {
        const paths: string[] = [];
        const record: RedactCallback = ({ path, value }) => {
            paths.push(path);
            return value;
        };
        redactPayloadText({ field: 'input', redact: record, stateId: 'Submit', text: 'a' });
        redactPayloadText({ field: 'cause', redact: record, text: 'b' });

        expect(paths).toEqual(['Submit.input', 'execution.cause']);
    });

    it('always reports kind: payload', () => {
        let seen = '';
        redactPayloadText({
            field: 'cause',
            redact: ({ kind, value }) => {
                seen = kind;
                return value;
            },
            text: 'x',
        });
        expect(seen).toBe('payload');
    });
});

describe('generateHtml redaction', () => {
    it('inlines the raw ASL whole by default, exactly as before', () => {
        const { html } = generateHtml({ aslDefinition: definition });
        expect(stateBlob(html).Fetch.Parameters).toEqual({
            FunctionName: 'fetch',
            Payload: { token: SECRET },
        });
    });

    it('keeps the secret out of the document once a hook asks for it', () => {
        const { html } = generateHtml({ aslDefinition: definition, redact: dropParameters });

        expect(html).not.toContain(SECRET);
        expect(stateBlob(html).Fetch.Parameters).toBe(REDACTED);
        // Only the panel data is governed - the diagram is still the same diagram.
        expect(html).toContain('data-state-id="Fetch"');
    });

    it('reaches nested states, whose ASL is inlined under its own scoped id', () => {
        const { html } = generateHtml({ aslDefinition: definition, redact: dropParameters });
        const blob = stateBlob(html);
        const nested = Object.keys(blob).filter((id) => id.endsWith('Inner'));

        expect(nested).toHaveLength(1);
        expect(blob[nested[0]].Parameters).toBe(REDACTED);
    });

    it('reaches a removed state\'s real ASL on the diff path', () => {
        // A diff draws its merged definition, in which a removed state is only an
        // orphan stub; collectHtmlStateData swaps the stub for the before side's real
        // ASL, which is the one way raw ASL enters the blob without passing through
        // collectStateData.
        const before: AslDefinition = {
            StartAt: 'Gone',
            States: {
                Gone: { Type: 'Task', Resource: 'arn:gone', Parameters: { token: SECRET }, End: true },
            },
        };
        const after: AslDefinition = {
            StartAt: 'Kept',
            States: { Kept: { Type: 'Succeed' } },
        };

        const plain = generateHtml({ aslDefinition: after, diff: { before } });
        expect(plain.html).toContain(SECRET);

        const { html } = generateHtml({ aslDefinition: after, diff: { before }, redact: dropParameters });
        expect(html).not.toContain(SECRET);
        expect(stateBlob(html).Gone.Parameters).toBe(REDACTED);
    });

    it('governs the execution payloads through the same hook', () => {
        const options = {
            aslDefinition: retryDefinition,
            history: historyWithPayloads() as never,
            includeExecutionPayloads: true,
        };

        expect(generateHtml(options).html).toContain(SECRET);

        const { html } = generateHtml({
            ...options,
            redact: ({ kind, value }) => (kind === 'payload' ? undefined : value),
        });
        expect(html).not.toContain(SECRET);

        const payloads = timelineBlob(html)
            .entries.flatMap((entry) => [entry.input, entry.output, entry.cause])
            .filter(Boolean) as Array<{ text: string }>;
        expect(payloads.length).toBeGreaterThan(0);
        for (const payload of payloads) expect(payload.text).toBe(REDACTED);
    });

    it('still reports the original length of a payload that was capped and then redacted', () => {
        const { html } = generateHtml({
            aslDefinition: retryDefinition,
            history: historyWithPayloads() as never,
            includeExecutionPayloads: true,
            redact: ({ kind, value }) => (kind === 'payload' ? undefined : value),
        });

        const truncated = timelineBlob(html)
            .entries.map((entry) => entry.output as { text: string; truncatedFrom?: number } | undefined)
            .find((payload) => payload?.truncatedFrom !== undefined);

        expect(truncated).toBeDefined();
        expect(truncated!.text).toBe(REDACTED);
        // The cap is a size budget and the hook a disclosure decision; a redacted
        // payload must not also claim to be a complete one.
        expect(truncated!.truncatedFrom).toBe(6014);
    });

    it('leaves the payloads alone when includeExecutionPayloads was never turned on', () => {
        let payloadCalls = 0;
        const { html } = generateHtml({
            aslDefinition: retryDefinition,
            history: historyWithPayloads() as never,
            redact: ({ kind, value }) => {
                if (kind === 'payload') payloadCalls += 1;
                return value;
            },
        });

        expect(payloadCalls).toBe(0);
        expect(html).not.toContain(SECRET);
    });
});

describe('generateViewerUpdate redaction', () => {
    it('governs the fragment a host swaps into a live viewer', () => {
        expect(JSON.stringify(generateViewerUpdate({ aslDefinition: definition }))).toContain(SECRET);

        const update = generateViewerUpdate({ aslDefinition: definition, redact: dropParameters });
        expect(JSON.stringify(update)).not.toContain(SECRET);
        expect(update.stateData.Fetch.Parameters).toBe(REDACTED);
    });
});

describe('buildExecutionTimeline redaction', () => {
    it('governs payloads for a caller building a timeline directly', () => {
        const events = historyWithPayloads().events as never;

        const plain = buildExecutionTimeline({ definition: retryDefinition, events, includePayloads: true });
        expect(JSON.stringify(plain)).toContain(SECRET);

        const timeline = buildExecutionTimeline({
            definition: retryDefinition,
            events,
            includePayloads: true,
            redact: ({ value }) => (typeof value === 'string' && value.includes(SECRET) ? undefined : value),
        });
        expect(JSON.stringify(timeline)).not.toContain(SECRET);
    });
});
