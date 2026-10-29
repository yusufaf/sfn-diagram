import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { generateMermaidDiff, generateMermaidExecution } from '../src/index';
import type { AslDefinition } from '../src/types';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');

const loadAsl = (name: string): AslDefinition =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8'));

const loadHistoryJson = (name: string): string =>
    readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf-8');

const baseAsl: AslDefinition = {
    StartAt: 'StepA',
    States: {
        StepA: { Next: 'StepB', Type: 'Pass' },
        StepB: { Next: 'StepC', Type: 'Task', Resource: 'arn:aws:lambda:::function:fn' },
        StepC: { End: true, Type: 'Succeed' },
    },
};

const modifiedAsl: AslDefinition = {
    StartAt: 'StepA',
    States: {
        StepA: { Next: 'StepB', Type: 'Pass' },
        StepB: { Next: 'NewStep', Resource: 'arn:aws:lambda:::function:fn-v2', Type: 'Task' },
        NewStep: { End: true, Type: 'Pass' },
    },
};

// `parallel-catch` with one branch's Task changed, so the change sits inside a container.
const withChangedBranch = (): AslDefinition => {
    const definition = loadAsl('parallel-catch');
    const parallel = definition.States.ParallelExecution;
    if (parallel.Type !== 'Parallel') throw new Error('fixture changed: ParallelExecution is not a Parallel');
    const branch1 = parallel.Branches[0].States.Branch1;
    if (branch1.Type !== 'Task') throw new Error('fixture changed: Branch1 is not a Task');
    branch1.Resource = 'arn:aws:lambda:us-east-1:123456789012:function:Branch1-v2';
    return definition;
};

// A commented state that assigns a variable, for the comment and variable options.
const annotatedAsl: AslDefinition = {
    StartAt: 'Prepare',
    States: {
        Prepare: { Assign: { total: 1 }, Comment: 'Seeds the total', Next: 'Charge', Type: 'Pass' },
        Charge: { End: true, Resource: 'arn:aws:lambda:::function:charge', Type: 'Task' },
    },
};

// Pins the output of both overlays when no new option is passed, so honouring
// the diagram options can't change what existing callers get.
describe('Mermaid overlays with no new options', () => {
    it('keeps the top-level diff output', () => {
        expect(generateMermaidDiff({ after: modifiedAsl, before: baseAsl })).toMatchSnapshot();
    });

    it('keeps the diff output for a change inside a container', () => {
        expect(
            generateMermaidDiff({ after: withChangedBranch(), before: loadAsl('parallel-catch') }),
        ).toMatchSnapshot();
    });

    it.each([
        ['retry', 'execution-retry-success'],
        ['parallel-catch', 'execution-parallel-caught'],
        ['map', 'execution-map-mixed'],
    ])('keeps the execution output for %s with %s', (aslName, historyName) => {
        expect(
            generateMermaidExecution({ aslDefinition: loadAsl(aslName), history: loadHistoryJson(historyName) }),
        ).toMatchSnapshot();
    });
});

const SNIPPET_HEADER = `import { generateMermaidDiff, generateMermaidExecution } from '../src/index';
const definition = '{"StartAt":"Only","States":{"Only":{"Type":"Pass","End":true}}}';
`;

const snippetErrors = (body: string): string[] =>
    typeErrorsIn({
        fileName: join(repoRoot, 'tests', '__mermaidOverlayOptions.snippet.ts'),
        sourceText: SNIPPET_HEADER + body,
    });

describe('option types', () => {
    // Literal arguments, so excess-property checks would reject an option the types lack.
    it(
        'accepts the Mermaid diagram options on both overlays',
        () => {
            expect(
                snippetErrors(`
generateMermaidDiff({
    after: definition,
    before: definition,
    catchHandling: 'hide',
    catchLabelStyle: 'catch-number',
    collapse: true,
    customColors: { Task: { fill: '#123456' } },
    includeComments: false,
    showVariables: false,
});
generateMermaidExecution({
    aslDefinition: definition,
    history: [],
    catchHandling: 'hide',
    catchLabelStyle: 'catch-number',
    collapse: true,
    customColors: { Task: { fill: '#123456' } },
    includeComments: false,
    showVariables: false,
});
`),
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS,
    );

    // Options with no meaning in Mermaid output stay rejected.
    it(
        'rejects SVG-only options on both overlays',
        () => {
            expect(
                snippetErrors(`
generateMermaidDiff({ after: definition, before: definition, nodeOverrides: {} });
generateMermaidExecution({ aslDefinition: definition, history: [], nodeOverrides: {} });
`),
            ).toEqual([expect.stringContaining('nodeOverrides'), expect.stringContaining('nodeOverrides')]);
        },
        COMPILE_TIMEOUT_MS,
    );
});

describe('generateMermaidDiff options', () => {
    it('draws customColors on unchanged states while the diff class wins on changed ones', () => {
        const { code } = generateMermaidDiff({
            after: modifiedAsl,
            before: baseAsl,
            customColors: { Task: { fill: '#123456' } },
        });

        expect(code).toMatch(/classDef taskState fill:#123456/);
        expect(code).toContain('class StepB diffModified');
        expect(code).toContain('class StepA passState');
    });

    it('flags a collapsed container that hides a change', () => {
        const { code } = generateMermaidDiff({
            after: withChangedBranch(),
            before: loadAsl('parallel-catch'),
            collapse: true,
        });

        expect(code).not.toContain('Branch1');
        expect(code).toContain('class ParallelExecution diffModified');
        expect(code).toContain('1 changed inside');
    });

    it('drops catch targets under catchHandling hide', () => {
        const definition = loadAsl('parallel-catch');
        const { code } = generateMermaidDiff({ after: definition, before: definition, catchHandling: 'hide' });

        expect(code).not.toContain('HandleError');
    });

    it('leaves comments out under includeComments false', () => {
        const { code } = generateMermaidDiff({ after: annotatedAsl, before: annotatedAsl, includeComments: false });

        expect(code).not.toContain('Seeds the total');
    });

    it('labels catch edges by number under catchLabelStyle catch-number', () => {
        const definition = loadAsl('parallel-catch');
        const { code } = generateMermaidDiff({
            after: definition,
            before: definition,
            catchLabelStyle: 'catch-number',
        });

        expect(code).toContain('ParallelExecution --> HandleError: Catch #35;1');
        expect(code).not.toContain('Error#58; States.ALL');
    });

    it('leaves variables out under showVariables false', () => {
        const { code } = generateMermaidDiff({ after: annotatedAsl, before: annotatedAsl, showVariables: false });

        expect(code).not.toContain('$total');
    });
});

describe('generateMermaidExecution options', () => {
    const caughtRun = () => ({
        aslDefinition: loadAsl('parallel-catch'),
        history: loadHistoryJson('execution-parallel-caught'),
    });

    it('rolls hidden statuses up onto a collapsed container', () => {
        const { code } = generateMermaidExecution({ ...caughtRun(), collapse: true });

        expect(code).not.toContain('Branch1');
        expect(code).toContain('class ParallelExecution execFailed');
        expect(code).toContain('820ms · 1/2 failed');
    });

    it('drops catch targets under catchHandling hide', () => {
        const { code } = generateMermaidExecution({ ...caughtRun(), catchHandling: 'hide' });

        expect(code).not.toContain('HandleError');
    });

    it('leaves variables out under showVariables false', () => {
        const shown = generateMermaidExecution({ aslDefinition: annotatedAsl, history: [] });
        const hidden = generateMermaidExecution({ aslDefinition: annotatedAsl, history: [], showVariables: false });

        expect(shown.code).toContain('$total');
        expect(hidden.code).not.toContain('$total');
    });

    it('emits customColors in the classDefs while every state keeps its run-status class', () => {
        const { code } = generateMermaidExecution({ ...caughtRun(), customColors: { Task: { fill: '#123456' } } });

        expect(code).toMatch(/classDef taskState fill:#123456/);
        expect(code).toMatch(/class Branch1 exec\w+/);
        expect(code).toMatch(/class Branch2 exec\w+/);
        expect(code).not.toMatch(/class \S+ taskState/);
    });

    // Non-regression guard: collapse changes what the diagram draws, not the run it summarises.
    it('keeps the history-derived status summary under collapse', () => {
        const { metadata: expanded } = generateMermaidExecution(caughtRun());
        const { metadata: collapsed } = generateMermaidExecution({ ...caughtRun(), collapse: true });

        expect({ ...collapsed, edgeCount: 0, stateCount: 0 }).toEqual({ ...expanded, edgeCount: 0, stateCount: 0 });
    });
});
