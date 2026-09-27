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

    it('caps an un-redacted payload and reports what it was cut from', () => {
        const { html } = generateHtml({
            aslDefinition: retryDefinition,
            history: historyWithPayloads() as never,
            includeExecutionPayloads: true,
        });

        const outputs = timelineBlob(html).entries.map(
            (entry) => entry.output as { text: string; truncatedFrom?: number } | undefined,
        );
        const truncated = outputs.find((payload) => payload?.truncatedFrom !== undefined);

        expect(truncated!.text).toHaveLength(4096);
        expect(truncated!.truncatedFrom).toBe(6014);
    });

    it('drops the truncation notice from a payload the hook replaced outright', () => {
        const { html } = generateHtml({
            aslDefinition: retryDefinition,
            history: historyWithPayloads() as never,
            includeExecutionPayloads: true,
            redact: ({ kind, value }) => (kind === 'payload' ? undefined : value),
        });

        const outputs = timelineBlob(html)
            .entries.map((entry) => entry.output as { text: string; truncatedFrom?: number } | undefined)
            .filter(Boolean);

        expect(outputs.length).toBeGreaterThan(0);
        for (const payload of outputs) {
            // `truncatedFrom` describes the text that was actually inlined. Ten
            // characters "truncated from 6014" reads as a preview of the original,
            // which is the opposite of what a redacted payload means.
            expect(payload!.text).toBe(REDACTED);
            expect(payload!.truncatedFrom).toBeUndefined();
        }
    });

    it('hands the hook the whole payload, before the cap, so it can parse it', () => {
        let parsedKeys: string[] = [];
        generateHtml({
            aslDefinition: retryDefinition,
            history: historyWithPayloads() as never,
            includeExecutionPayloads: true,
            redact: ({ kind, path, value }) => {
                if (kind !== 'payload' || !path.endsWith('.output')) return value;
                // A payload cut off mid-token would throw here.
                const parsed = JSON.parse(value as string) as Record<string, unknown>;
                parsedKeys = Object.keys(parsed);
                return JSON.stringify({ ...parsed, receipt: REDACTED });
            },
        });

        expect(parsedKeys).toEqual(['receipt']);
    });

    it('captures no input, output or cause when includeExecutionPayloads was never turned on', () => {
        const fields: string[] = [];
        const { html } = generateHtml({
            aslDefinition: retryDefinition,
            history: historyWithPayloads() as never,
            redact: ({ kind, path, value }) => {
                if (kind === 'payload') fields.push(path.slice(path.lastIndexOf('.') + 1));
                return value;
            },
        });

        // Error names are inlined either way, so they are still offered; the payloads
        // proper were never captured, so there is nothing to offer.
        expect(new Set(fields)).toEqual(new Set(['error']));
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
describe('redaction of an execution run\'s other text', () => {
    /** A Parallel whose two branches are still open when the container fails. */
    const parallelDefinition: AslDefinition = {
        StartAt: 'Fan',
        States: {
            Fan: {
                Type: 'Parallel',
                Branches: [
                    { StartAt: 'Left', States: { Left: { Type: 'Task', Resource: 'arn:l', End: true } } },
                    { StartAt: 'Right', States: { Right: { Type: 'Task', Resource: 'arn:r', End: true } } },
                ],
                Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Recover' }],
                Next: 'Done',
            },
            Recover: { Type: 'Pass', Next: 'Done' },
            Done: { Type: 'Succeed' },
        },
    };

    /** Both leaves are abandoned by the container's failure, so both take its cause. */
    const abandonedLeafHistory = (): unknown[] => [
        { id: 1, type: 'ExecutionStarted', timestamp: '2024-01-01T00:00:00Z' },
        {
            id: 2,
            type: 'ParallelStateEntered',
            timestamp: '2024-01-01T00:00:01Z',
            stateEnteredEventDetails: { name: 'Fan' },
        },
        { id: 3, type: 'ParallelStateStarted', timestamp: '2024-01-01T00:00:01Z' },
        {
            id: 4,
            type: 'TaskStateEntered',
            timestamp: '2024-01-01T00:00:02Z',
            stateEnteredEventDetails: { name: 'Left' },
        },
        {
            id: 5,
            type: 'TaskStateEntered',
            timestamp: '2024-01-01T00:00:02Z',
            stateEnteredEventDetails: { name: 'Right' },
        },
        {
            id: 6,
            type: 'ParallelStateFailed',
            timestamp: '2024-01-01T00:00:03Z',
            executionFailedEventDetails: { cause: `branch blew up: ${SECRET}`, error: `Boom.${SECRET}` },
        },
        {
            id: 7,
            type: 'ParallelStateExited',
            timestamp: '2024-01-01T00:00:04Z',
            stateExitedEventDetails: { name: 'Fan' },
        },
    ];

    it('offers one shared cause once per entry it lands in, under that entry\'s id', () => {
        const offered: Array<{ path: string; stateId?: string }> = [];
        const timeline = buildExecutionTimeline({
            definition: parallelDefinition,
            events: abandonedLeafHistory() as never,
            includePayloads: true,
            redact: ({ kind, path, stateId, value }) => {
                if (kind === 'payload') offered.push({ path, stateId });
                return value;
            },
        });

        // The container's cause is written onto both abandoned leaves and onto the
        // container itself, so a hook keyed on stateId has to see all three - not one
        // offer under the container's id standing in for every copy.
        const causeTargets = offered.filter((call) => call.path.endsWith('.cause')).map((c) => c.stateId);
        expect(new Set(causeTargets)).toEqual(new Set(['Fan', 'Left', 'Right']));

        const withCause = timeline.entries.filter((entry) => entry.cause !== undefined);
        expect(withCause.length).toBe(3);
    });

    it('lets a per-state hook redact the copy shown under that state', () => {
        const timeline = buildExecutionTimeline({
            definition: parallelDefinition,
            events: abandonedLeafHistory() as never,
            includePayloads: true,
            redact: ({ kind, stateId, value }) =>
                kind === 'payload' && stateId === 'Right' ? undefined : value,
        });

        const byNode = new Map(timeline.entries.map((entry) => [entry.nodeId, entry]));
        expect(byNode.get('Right')!.cause!.text).toBe(REDACTED);
        expect(byNode.get('Left')!.cause!.text).toContain(SECRET);
    });

    it('redacts the error name too, with no includeExecutionPayloads needed', () => {
        const plain = generateHtml({
            aslDefinition: parallelDefinition,
            history: { events: abandonedLeafHistory() } as never,
        });
        // The error name rides on every execution document, opt-in or not.
        expect(plain.html).toContain(`Boom.${SECRET}`);

        const { html } = generateHtml({
            aslDefinition: parallelDefinition,
            history: { events: abandonedLeafHistory() } as never,
            redact: ({ kind, value }) => (kind === 'payload' ? undefined : value),
        });
        expect(html).not.toContain(SECRET);

        const errors = timelineBlob(html)
            .entries.map((entry) => entry.error)
            .filter(Boolean);
        expect(errors.length).toBeGreaterThan(0);
        for (const error of errors) expect(error).toBe(REDACTED);
    });

    it('paths an error by its state and field', () => {
        const paths: string[] = [];
        buildExecutionTimeline({
            definition: parallelDefinition,
            events: abandonedLeafHistory() as never,
            redact: ({ path, value }) => {
                paths.push(path);
                return value;
            },
        });

        expect(paths).toContain('Fan.error');
        // Without includePayloads nothing else is offered - errors are the exception.
        expect(paths.every((path) => path.endsWith('.error'))).toBe(true);
    });
});

describe('values the walk must not damage', () => {
    it('leaves an absent optional field absent rather than calling it redacted', () => {
        const redacted = redactStateData({
            redact: ({ value }) => value,
            stateData: { Fetch: { Type: 'Pass', Comment: undefined } as unknown as AslState },
        });

        expect(redacted.Fetch.Comment).toBeUndefined();
        expect(JSON.stringify(redacted)).not.toContain(REDACTED);
    });

    it('treats a non-plain object as a leaf instead of rebuilding it as {}', () => {
        const stamped = new Date('2024-01-01T00:00:00Z');
        const redacted = redactStateData({
            redact: ({ value }) => value,
            stateData: { Fetch: { Type: 'Pass', Comment: stamped } as unknown as AslState },
        });

        expect(redacted.Fetch.Comment).toBe(stamped);
        expect(JSON.parse(JSON.stringify(redacted)).Fetch.Comment).toBe('2024-01-01T00:00:00.000Z');
    });

    it('keeps a __proto__ key as a key, and redacts it like any other', () => {
        // JSON.parse makes __proto__ an own enumerable property, where a plain
        // `next[key] = …` would hand it to the prototype setter and lose it.
        const parsed = JSON.parse(`{"Type":"Pass","__proto__":{"token":"${SECRET}"}}`) as AslState;
        const redacted = redactStateData({
            redact: ({ path, value }) => (path.endsWith('.__proto__') ? undefined : value),
            stateData: { Fetch: parsed },
        });

        expect(Object.keys(redacted.Fetch)).toEqual(['Type', '__proto__']);
        expect(JSON.parse(JSON.stringify(redacted)).Fetch.__proto__).toBe(REDACTED);
        expect(JSON.stringify(redacted)).not.toContain(SECRET);
    });

    it('offers a nested state\'s ASL again inside its container, under the container\'s id', () => {
        // collectStateData stores a container's own ASL, children and all, as well as
        // each child under its own scoped id - so a stateId-keyed hook that only knows
        // about the child leaves a verbatim copy in the container's entry.
        const perState = generateHtml({
            aslDefinition: definition,
            redact: ({ stateId, value }) => (stateId?.endsWith('Inner') ? undefined : value),
        });
        expect(perState.html).toContain(SECRET);

        // Keyed on the path instead, both copies go.
        const byPath = generateHtml({ aslDefinition: definition, redact: dropParameters });
        expect(byPath.html).not.toContain(SECRET);
    });
});
