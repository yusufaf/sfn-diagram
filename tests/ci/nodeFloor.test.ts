import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = resolve(__dirname, '../..');

interface UnitTestWorkflow {
    jobs: { test: { strategy: { matrix: { include: { node: number | string }[] } } } };
}

const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf-8')) as {
    engines: { node: string };
};
const workflow = parse(
    readFileSync(resolve(repoRoot, '.github/workflows/unit-test.yml'), 'utf-8'),
) as UnitTestWorkflow;
// lts/* moves with time, so only legs pinned to a major line can be compared with the floor.
const pinnedMajors = workflow.jobs.test.strategy.matrix.include
    .map((leg) => String(leg.node))
    .filter((node) => /^\d+$/.test(node))
    .map(Number);
const floorMajor = Number(/^>=(\d+)/.exec(packageJson.engines.node)?.[1]);

describe('Node floor', () => {
    it('declares >=22.12.0, the first 22.x that can require() an ES module unflagged', () => {
        expect(packageJson.engines.node).toBe('>=22.12.0');
    });

    it('tests the major line the floor sits on', () => {
        expect(pinnedMajors).toContain(floorMajor);
    });

    it('tests no Node line below the floor', () => {
        for (const major of pinnedMajors) {
            expect(major).toBeGreaterThanOrEqual(floorMajor);
        }
    });
});
