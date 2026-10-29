import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { generateMermaidDiff, generateMermaidExecution } from '../src/index';
import type { AslDefinition } from '../src/types';

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
