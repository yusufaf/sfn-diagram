import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateDiff, generateMermaidDiff } from '../src/index';
import type { AslDefinition } from '../src/types';

function loadFixture(name: string): AslDefinition {
    return JSON.parse(
        readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8'),
    ) as AslDefinition;
}

/** The `fill` of the node whose `data-state-id` is `id`, or undefined when absent. */
function nodeFill(svg: string, id: string): string | undefined {
    const match = svg.match(new RegExp(`data-state-id="${id}"[^>]*>(?:<title>[^<]*</title>)?<(?:rect|path|circle|polygon)[^>]*fill="([^"]+)"`));
    return match?.[1];
}

const ADDED = '#c8e6c9';
const MODIFIED = '#fff9c4';
const REMOVED = '#ffcdd2';

describe('nested state diff (issue #206)', () => {
    const before = loadFixture('diff-nested-before');
    const after = loadFixture('diff-nested-after');

    it('classifies states inside a Parallel branch individually', () => {
        const { metadata } = generateDiff({ after, before });

        expect(metadata.added).toEqual(['Publish']);
        expect(metadata.removed).toEqual(['Archive']);
        expect(metadata.modified).toContain('Enrich');
        expect(metadata.unchanged).toContain('Validate');
        expect(metadata.unchanged).toContain('Notify');
    });

    it('classifies states inside a Map processor individually', () => {
        const { metadata } = generateDiff({ after, before });

        expect(metadata.modified).toContain('Transform');
        expect(metadata.unchanged).toContain('Store');
    });

    it('still marks the containers themselves modified', () => {
        const { metadata } = generateDiff({ after, before });

        expect(metadata.modified).toEqual(['FanOut', 'Enrich', 'ProcessItems', 'Transform']);
        expect(metadata.unchanged).toEqual(['Validate', 'Notify', 'Store', 'Done']);
    });

    it('colours nested nodes in the SVG', () => {
        const { svg } = generateDiff({ after, before });

        expect(nodeFill(svg, 'Enrich')).toBe(MODIFIED);
        expect(nodeFill(svg, 'Publish')).toBe(ADDED);
        expect(nodeFill(svg, 'Archive')).toBe(REMOVED);
        expect(nodeFill(svg, 'Transform')).toBe(MODIFIED);
        expect(nodeFill(svg, 'Validate')).not.toBe(MODIFIED);
    });

    it('keeps a removed nested state as an orphan inside its own container', () => {
        const { code } = generateMermaidDiff({ after, before });

        // The orphan lives in FanOut's first branch, so its End collects into the
        // branch end and flows on to FanOut's Next — a top-level orphan would have
        // no outgoing edge at all.
        expect(code).toContain('Archive --> ProcessItems');
    });

    it('annotates a collapsed container with the number of changes inside', () => {
        const { svg } = generateDiff({ after, before, collapse: true });

        // FanOut hides Enrich (modified), Publish (added) and Archive (removed);
        // ProcessItems hides Transform (modified).
        expect(svg).toContain('3 changed inside');
        expect(svg).toContain('1 changed inside');
    });

    it('emits Mermaid diff classes for nested states', () => {
        const { code, metadata } = generateMermaidDiff({ after, before });

        expect(code).toContain('class Enrich diffModified');
        expect(code).toContain('class Publish diffAdded');
        expect(code).toContain('class Archive diffRemoved');
        expect(code).toContain('class Transform diffModified');
        expect(metadata.added).toEqual(['Publish']);
        expect(metadata.removed).toEqual(['Archive']);
    });

    it('supports the legacy Iterator field', () => {
        const legacyBefore: AslDefinition = {
            StartAt: 'Loop',
            States: {
                Loop: {
                    End: true,
                    Iterator: {
                        StartAt: 'Step',
                        States: { Step: { End: true, Resource: 'arn:a', Type: 'Task' } },
                    },
                    Type: 'Map',
                },
            },
        };
        const legacyAfter: AslDefinition = {
            StartAt: 'Loop',
            States: {
                Loop: {
                    End: true,
                    Iterator: {
                        StartAt: 'Step',
                        States: { Step: { End: true, Resource: 'arn:b', Type: 'Task' } },
                    },
                    Type: 'Map',
                },
            },
        };

        const { metadata, svg } = generateDiff({ after: legacyAfter, before: legacyBefore });

        expect(metadata.modified).toEqual(['Loop', 'Step']);
        expect(nodeFill(svg, 'Step')).toBe(MODIFIED);
    });

    it('marks every state inside an added container as added', () => {
        const flat: AslDefinition = {
            StartAt: 'A',
            States: { A: { End: true, Type: 'Pass' } },
        };
        const withParallel: AslDefinition = {
            StartAt: 'A',
            States: {
                A: { Next: 'Fan', Type: 'Pass' },
                Fan: {
                    Branches: [
                        { StartAt: 'X', States: { X: { End: true, Type: 'Pass' } } },
                        { StartAt: 'Y', States: { Y: { End: true, Type: 'Pass' } } },
                    ],
                    End: true,
                    Type: 'Parallel',
                },
            },
        };

        const { metadata, svg } = generateDiff({ after: withParallel, before: flat });

        expect(metadata.added).toEqual(['Fan', 'X', 'Y']);
        expect(nodeFill(svg, 'X')).toBe(ADDED);
        expect(nodeFill(svg, 'Y')).toBe(ADDED);
    });

    it('does not list the descendants of a removed container', () => {
        // The orphan stub is the only trace of the removed subtree; listing `Validate`
        // as removed would colour the surviving top-level Validate node red.
        const withParallel: AslDefinition = {
            StartAt: 'Fan',
            States: {
                Fan: {
                    Branches: [
                        { StartAt: 'Validate', States: { Validate: { End: true, Type: 'Pass' } } },
                    ],
                    Next: 'Validate',
                    Type: 'Parallel',
                },
                Validate: { End: true, Resource: 'arn:v', Type: 'Task' },
            },
        };
        const flat: AslDefinition = {
            StartAt: 'Validate',
            States: { Validate: { End: true, Resource: 'arn:v', Type: 'Task' } },
        };

        const { metadata, svg } = generateDiff({ after: flat, before: withParallel });

        expect(metadata.removed).toEqual(['Fan']);
        expect(metadata.unchanged).toEqual(['Validate']);
        expect(nodeFill(svg, 'Validate')).not.toBe(REMOVED);
    });

    it('treats a container whose type changed as a fresh block', () => {
        const asMap: AslDefinition = {
            StartAt: 'C',
            States: {
                C: {
                    End: true,
                    ItemProcessor: {
                        StartAt: 'Inner',
                        States: { Inner: { End: true, Type: 'Pass' } },
                    },
                    Type: 'Map',
                },
            },
        };
        const asParallel: AslDefinition = {
            StartAt: 'C',
            States: {
                C: {
                    Branches: [{ StartAt: 'Inner', States: { Inner: { End: true, Type: 'Pass' } } }],
                    End: true,
                    Type: 'Parallel',
                },
            },
        };

        const { metadata } = generateDiff({ after: asParallel, before: asMap });

        expect(metadata.modified).toEqual(['C']);
        expect(metadata.added).toEqual(['Inner']);
        expect(metadata.removed).toEqual([]);
    });

    it('reports scoped ids for a name that repeats across scopes', () => {
        const build = (resource: string): AslDefinition => ({
            StartAt: 'Fan',
            States: {
                Fan: {
                    Branches: [
                        {
                            StartAt: 'Validate',
                            States: { Validate: { End: true, Resource: resource, Type: 'Task' } },
                        },
                    ],
                    Next: 'Validate',
                    Type: 'Parallel',
                },
                Validate: { End: true, Resource: 'arn:top', Type: 'Task' },
            },
        });

        const { metadata, svg } = generateDiff({ after: build('arn:b'), before: build('arn:a') });

        // The nested occurrence is the one that changed; the root one keeps its bare
        // name and must not pick up the modified colour.
        expect(metadata.modified).toEqual(['Fan', 'Fan__branch0__Validate']);
        expect(metadata.unchanged).toEqual(['Validate']);
        expect(nodeFill(svg, 'Fan__branch0__Validate')).toBe(MODIFIED);
        expect(nodeFill(svg, 'Validate')).not.toBe(MODIFIED);
    });

    it('renders a removed nested state under the query language it was written in', () => {
        const jsonata: AslDefinition = {
            QueryLanguage: 'JSONata',
            StartAt: 'Fan',
            States: {
                Fan: {
                    Branches: [
                        {
                            StartAt: 'Go',
                            States: {
                                Go: { Next: 'Reject', Type: 'Pass' },
                                Reject: { Error: "{% 'Rejected' %}", Type: 'Fail' },
                            },
                        },
                    ],
                    End: true,
                    Type: 'Parallel',
                },
            },
        };
        const jsonpath: AslDefinition = {
            StartAt: 'Fan',
            States: {
                Fan: {
                    Branches: [{ StartAt: 'Go', States: { Go: { End: true, Type: 'Pass' } } }],
                    End: true,
                    Type: 'Parallel',
                },
            },
        };

        const { code, metadata } = generateMermaidDiff({ after: jsonpath, before: jsonata });

        expect(metadata.removed).toEqual(['Reject']);
        expect(code).toContain('class Reject diffRemoved');
        expect(code).toContain("error: 'Rejected'");
        expect(code).not.toContain('{%');
    });
});
