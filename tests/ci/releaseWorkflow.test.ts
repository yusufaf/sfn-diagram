import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = resolve(__dirname, '../..');

interface WorkflowStep {
    name?: string;
    run?: string;
    uses?: string;
    with?: Record<string, string>;
}

interface WorkflowJob {
    if?: string;
    needs?: string | string[];
    steps?: WorkflowStep[];
}

interface ReleaseWorkflow {
    jobs: Record<string, WorkflowJob>;
}

interface DispatchPrefixParams {
    jobName: string;
}

const workflow = parse(
    readFileSync(resolve(repoRoot, '.github/workflows/release-please.yml'), 'utf-8'),
) as ReleaseWorkflow;
const reactJob = workflow.jobs['react-npm-publish'];
const reactSteps = reactJob.steps ?? [];

const normalize = (expression = ''): string => expression.replace(/\s+/g, ' ').trim();

/**
 * Read the tag prefix a job's `if` accepts on a `publish_tag` dispatch.
 *
 * @param params - `jobName`: the job in release-please.yml to read.
 * @returns The literal in `startsWith(github.event.inputs.publish_tag, '<prefix>')`, or
 * undefined when the job has no such clause.
 */
function dispatchPrefix(params: DispatchPrefixParams): string | undefined {
    const { jobName } = params;
    const condition = normalize(workflow.jobs[jobName]?.if);
    return /startsWith\(github\.event\.inputs\.publish_tag, '([^']+)'\)/.exec(condition)?.[1];
}

describe('release workflow: react-npm-publish', () => {
    it('waits for core npm-publish', () => {
        const needs = [reactJob.needs ?? []].flat();
        expect(needs).toContain('npm-publish');
        expect(needs).toContain('release-please');
    });

    it('runs only after core npm-publish succeeded or was skipped', () => {
        const condition = normalize(reactJob.if);
        expect(condition).toContain(
            "(needs.npm-publish.result == 'success' || needs.npm-publish.result == 'skipped')",
        );
        expect(condition).toContain('!cancelled()');
        expect(condition).not.toContain('always()');
    });

    it('a React publish_tag dispatch reaches it and no core publish job', () => {
        const reactPrefix = dispatchPrefix({ jobName: 'react-npm-publish' });
        expect(reactPrefix).toBeDefined();
        expect('sfn-diagram-react-v1.0.0'.startsWith(reactPrefix ?? '\0')).toBe(true);
        expect('sfn-diagram-v2.0.0'.startsWith(reactPrefix ?? '\0')).toBe(false);
        for (const jobName of ['npm-publish', 'jsr-publish', 'binaries']) {
            const corePrefix = dispatchPrefix({ jobName }) ?? '\0';
            expect('sfn-diagram-v2.0.0'.startsWith(corePrefix), jobName).toBe(true);
            expect('sfn-diagram-react-v1.0.0'.startsWith(corePrefix), jobName).toBe(false);
        }
    });

    it('checks out the dispatched tag on a recovery run', () => {
        const checkout = reactSteps.find((step) => step.uses?.startsWith('actions/checkout'));
        expect(checkout?.with?.ref).toContain('github.event.inputs.publish_tag');
        expect(checkout?.with?.ref).toContain('needs.release-please.outputs.react_tag_name');
    });

    it('refuses to publish when the sfn-diagram peer resolves to nothing on npm', () => {
        const names = reactSteps.map((step) => step.name);
        const peerIndex = names.indexOf('Assert the sfn-diagram peer resolves on npm');
        expect(peerIndex).toBeGreaterThanOrEqual(0);
        expect(peerIndex).toBeLessThan(names.indexOf('Publish to npm'));
        expect(reactSteps[peerIndex]?.run).toContain('npm view "sfn-diagram@$RANGE" version');
    });
});

describe('release workflow: npm-publish verify', () => {
    const verifyRun =
        (workflow.jobs['npm-publish'].steps ?? []).find(
            (step) => step.name === 'Verify the published version on npm',
        )?.run ?? '';
    const tokens = [
        'npm view sfn-diagram@"$VERSION" version',
        'npm view sfn-diagram@"$VERSION" dist.tarball',
        'node scripts/wait-for-npm-tarball.mjs --url "$TARBALL" --timeout-minutes 15',
        'cd "$(mktemp -d)"',
        'npx --yes',
    ];

    it('waits for the tarball after npm view sees the version and before npx runs', () => {
        const positions = tokens.map((token) => verifyRun.indexOf(token));
        tokens.forEach((token, index) => {
            expect(positions[index], token).toBeGreaterThanOrEqual(0);
        });
        // The script path is relative to the checkout, so it must run before the cd.
        for (let index = 1; index < positions.length; index++) {
            expect(positions[index], tokens[index]).toBeGreaterThan(positions[index - 1]);
        }
    });

    it('reports an npx failure separately from a tarball that never appeared', () => {
        expect(verifyRun).toContain('::error::tarball is served, but npx');
    });
});
