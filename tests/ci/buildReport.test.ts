import { describe, expect, it, vi } from 'vitest';
import type { AslDefinition } from '../../src/types';
import {
    assembleCommentBody,
    buildAslFileSection,
    buildExecutionOverlaySection,
    formatStateList,
    isAslDefinition,
    matchesPatterns,
    parseAslJson,
    renderAslFileSection,
} from '../../src/ci/buildReport';

const beforeAsl: AslDefinition = {
    StartAt: 'ValidateOrder',
    States: {
        ValidateOrder: { Type: 'Pass', Next: 'CheckStock' },
        CheckStock: {
            Choices: [
                {
                    BooleanEquals: true,
                    Next: 'ChargePayment',
                    Variable: '$.inStock',
                },
            ],
            Default: 'CancelOrder',
            Type: 'Choice',
        },
        ChargePayment: {
            Next: 'ShipOrder',
            Resource: 'arn:aws:lambda:::function:charge-v1',
            Type: 'Task',
        },
        ShipOrder: {
            Next: 'OrderComplete',
            Resource: 'arn:aws:lambda:::function:ship',
            Type: 'Task',
        },
        CancelOrder: { Error: 'OutOfStock', Type: 'Fail' },
        OrderComplete: { Type: 'Succeed' },
    },
};

// FraudCheck added, ChargePayment modified, CancelOrder removed.
const afterAsl: AslDefinition = {
    StartAt: 'ValidateOrder',
    States: {
        ValidateOrder: { Type: 'Pass', Next: 'CheckStock' },
        CheckStock: {
            Choices: [
                {
                    BooleanEquals: true,
                    Next: 'ChargePayment',
                    Variable: '$.inStock',
                },
            ],
            Default: 'OrderComplete',
            Type: 'Choice',
        },
        ChargePayment: {
            Next: 'FraudCheck',
            Resource: 'arn:aws:lambda:::function:charge-v2',
            Type: 'Task',
        },
        FraudCheck: {
            Next: 'ShipOrder',
            Resource: 'arn:aws:lambda:::function:fraud',
            Type: 'Task',
        },
        ShipOrder: {
            Next: 'OrderComplete',
            Resource: 'arn:aws:lambda:::function:ship',
            Type: 'Task',
        },
        OrderComplete: { Type: 'Succeed' },
    },
};

describe('isAslDefinition', () => {
    it('accepts a minimal valid ASL shape', () => {
        expect(
            isAslDefinition({
                StartAt: 'A',
                States: { A: { Type: 'Succeed' } },
            }),
        ).toBe(true);
    });

    it('rejects non-ASL objects and non-objects', () => {
        expect(isAslDefinition({ foo: 'bar' })).toBe(false);
        expect(isAslDefinition(null)).toBe(false);
        expect(isAslDefinition('a string')).toBe(false);
        expect(isAslDefinition({ StartAt: 1, States: {} })).toBe(false);
    });
});

describe('parseAslJson', () => {
    it('parses valid ASL JSON', () => {
        expect(parseAslJson(JSON.stringify(beforeAsl))).toEqual(beforeAsl);
    });

    it('returns null for invalid JSON', () => {
        expect(parseAslJson('{not json')).toBeNull();
    });

    it('returns null for well-formed JSON that is not ASL', () => {
        expect(parseAslJson(JSON.stringify({ hello: 'world' }))).toBeNull();
    });
});

describe('matchesPatterns', () => {
    const patterns = ['**/*.asl.json', '**/*.asl'];

    it('matches nested ASL files', () => {
        expect(matchesPatterns('workflows/order.asl.json', patterns)).toBe(
            true,
        );
        expect(matchesPatterns('deep/nested/state.asl', patterns)).toBe(true);
    });

    it('matches a top-level ASL file via matchBase', () => {
        expect(matchesPatterns('order.asl.json', patterns)).toBe(true);
    });

    it('rejects non-ASL files', () => {
        expect(matchesPatterns('README.md', patterns)).toBe(false);
        expect(matchesPatterns('src/order.ts', patterns)).toBe(false);
    });
});

describe('formatStateList', () => {
    it('wraps each name in backticks and comma-joins', () => {
        expect(formatStateList(['A', 'B'])).toBe('`A`, `B`');
    });

    it('returns an empty string for no names', () => {
        expect(formatStateList([])).toBe('');
    });
});

describe('buildAslFileSection', () => {
    it('returns null when neither side parsed as ASL', () => {
        expect(
            buildAslFileSection({
                afterAsl: null,
                beforeAsl: null,
                filename: 'x.asl.json',
            }),
        ).toBeNull();
    });

    it('builds a "New file" section for an added file', () => {
        const section = buildAslFileSection({
            afterAsl,
            beforeAsl: null,
            filename: 'flows/new.asl.json',
        });
        expect(section).not.toBeNull();
        expect(section?.header).toContain('✨ **New file**');
        expect(section?.mermaidLabel).toBe('📊 Diagram');
        expect(section?.mermaidOpenByDefault).toBe(false);
        expect(section?.afterAsl).toEqual(afterAsl);
        expect(section?.mermaidCode).toContain('stateDiagram-v2');
    });

    it('builds a "File deleted" section with a before-diagram', () => {
        const section = buildAslFileSection({
            afterAsl: null,
            beforeAsl,
            filename: 'flows/gone.asl.json',
        });
        expect(section?.header).toContain('⚠️ **File deleted**');
        expect(section?.mermaidLabel).toBe('📊 Before diagram');
        expect(section?.afterAsl).toBeNull();
    });

    it('builds a diff section with a change-summary table for a modified file', () => {
        const section = buildAslFileSection({
            afterAsl,
            beforeAsl,
            filename: 'flows/order.asl.json',
        });
        expect(section?.header).toContain('➕ Added');
        expect(section?.header).toContain('`FraudCheck`');
        expect(section?.header).toContain('✏️ Modified');
        expect(section?.header).toContain('❌ Removed');
        expect(section?.header).toContain('`CancelOrder`');
        expect(section?.mermaidOpenByDefault).toBe(true);
        expect(section?.mermaidCode).toContain('classDef diffAdded');
    });

    it('reports "No changes" when a modified file diffs to no state changes', () => {
        const section = buildAslFileSection({
            afterAsl: beforeAsl,
            beforeAsl,
            filename: 'flows/same.asl.json',
        });
        expect(section?.header).toContain('✅ No changes');
    });

    it('applies catchHandling to plain (added/deleted) sections but not to a diff', () => {
        const withCatch: AslDefinition = {
            StartAt: 'Risky',
            States: {
                Risky: {
                    Type: 'Task',
                    Resource: 'arn:aws:lambda:::function:risky',
                    Catch: [{ ErrorEquals: ['States.ALL'], Next: 'Handle' }],
                    End: true,
                },
                Handle: { Type: 'Fail', Error: 'Boom' },
            },
        };
        const shown = buildAslFileSection({
            afterAsl: withCatch,
            beforeAsl: null,
            filename: 'a.asl.json',
        });
        const hidden = buildAslFileSection(
            { afterAsl: withCatch, beforeAsl: null, filename: 'a.asl.json' },
            { catchHandling: 'hide' },
        );
        expect(shown?.mermaidCode).toContain('Handle');
        expect(hidden?.mermaidCode).not.toContain('Handle');
    });
});

describe('renderAslFileSection', () => {
    const section = buildAslFileSection({
        afterAsl,
        beforeAsl: null,
        filename: 'flows/new.asl.json',
    });

    it('inlines the mermaid block by default', () => {
        const markdown = renderAslFileSection(section!);
        expect(markdown).toContain('```mermaid');
        expect(markdown).toContain('<details>');
    });

    it('renders diff sections as <details open>', () => {
        const diffSection = buildAslFileSection({
            afterAsl,
            beforeAsl,
            filename: 'flows/order.asl.json',
        });
        expect(renderAslFileSection(diffSection!)).toContain('<details open>');
    });

    it('omits the mermaid block and header stays intact when includeDiagram is false', () => {
        const markdown = renderAslFileSection(section!, {
            includeDiagram: false,
        });
        expect(markdown).not.toContain('```mermaid');
        expect(markdown).toContain('Diagram omitted');
        expect(markdown).toContain('✨ **New file**');
    });
});

describe('buildExecutionOverlaySection', () => {
    it('skips with an info log when there are no candidates', async () => {
        const result = await buildExecutionOverlaySection({
            candidates: [],
            fetchExecution: vi.fn(),
            mode: 'latest',
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:x',
        });
        expect(result.section).toBeNull();
        expect(result.log).toMatchObject({ level: 'info' });
    });

    it('skips with a warning when multiple candidates are present', async () => {
        const result = await buildExecutionOverlaySection({
            candidates: [
                { afterAsl, filename: 'a.asl.json' },
                { afterAsl, filename: 'b.asl.json' },
            ],
            fetchExecution: vi.fn(),
            mode: 'latest',
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:x',
        });
        expect(result.section).toBeNull();
        expect(result.log).toMatchObject({ level: 'warning' });
    });

    it('surfaces a fetch failure as a warning, not a throw', async () => {
        const result = await buildExecutionOverlaySection({
            candidates: [{ afterAsl, filename: 'a.asl.json' }],
            fetchExecution: vi.fn().mockRejectedValue(new Error('boom')),
            mode: 'latest',
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:x',
        });
        expect(result.section).toBeNull();
        expect(result.log?.message).toContain('boom');
    });

    it('reports info when no matching execution is found', async () => {
        const result = await buildExecutionOverlaySection({
            candidates: [{ afterAsl, filename: 'a.asl.json' }],
            fetchExecution: vi.fn().mockResolvedValue(undefined),
            mode: 'latest-failed',
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:x',
        });
        expect(result.section).toBeNull();
        expect(result.log?.message).toContain('no failed execution found');
    });

    it('builds an execution overlay section on success', async () => {
        const result = await buildExecutionOverlaySection({
            candidates: [{ afterAsl, filename: 'a.asl.json' }],
            fetchExecution: vi.fn().mockResolvedValue({
                events: [],
                executionArn: 'arn:aws:states:us-east-1:1:execution:x:run-1',
                status: 'SUCCEEDED',
            }),
            mode: 'latest',
            stateMachineArn: 'arn:aws:states:us-east-1:1:stateMachine:x',
        });
        expect(result.section).toContain('Execution overlay');
        expect(result.section).toContain('run-1');
        expect(result.section).toContain('```mermaid');
    });
});

describe('assembleCommentBody', () => {
    it('joins marker, heading, sections, and footer', () => {
        const body = assembleCommentBody({
            marker: '<!-- x -->',
            sections: ['one', 'two'],
        });
        expect(body.startsWith('<!-- x -->\n')).toBe(true);
        expect(body).toContain('## 🔀 Step Functions Diagram Changes');
        expect(body).toContain('one\n---\n\ntwo');
        expect(body).toContain('sfn-diagram');
    });

    it('honors a custom heading and footer', () => {
        const body = assembleCommentBody({
            footer: 'custom footer',
            heading: '# Custom',
            marker: '<!-- x -->',
            sections: ['s'],
        });
        expect(body).toContain('# Custom');
        expect(body).toContain('custom footer');
    });
});
