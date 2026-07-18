import { expect, test } from 'vitest';
import {
    generateSvg,
    generateMermaid,
    generateDiagram,
    SfnDiagramGenerator,
    AWS_LIGHT_THEME,
    AWS_DARK_THEME,
} from '../src';
import type { AslDefinition } from '../src';

test('exports generateSvg function', () => {
    expect(typeof generateSvg).toBe('function');
});

test('exports generateMermaid function', () => {
    expect(typeof generateMermaid).toBe('function');
});

test('exports generateDiagram function', () => {
    expect(typeof generateDiagram).toBe('function');
});

test('exports SfnDiagramGenerator class', () => {
    expect(typeof SfnDiagramGenerator).toBe('function');
});

test('exports AWS_LIGHT_THEME constant', () => {
    expect(AWS_LIGHT_THEME).toBeDefined();
    expect(typeof AWS_LIGHT_THEME.background).toBe('string');
});

test('exports AWS_DARK_THEME constant', () => {
    expect(AWS_DARK_THEME).toBeDefined();
    expect(typeof AWS_DARK_THEME.background).toBe('string');
});

test('can create minimal diagram', () => {
    const aslDefinition: AslDefinition = {
        StartAt: 'Hello',
        States: {
            Hello: {
                Type: 'Pass',
                End: true,
            },
        },
    };

    const result = generateSvg({ aslDefinition });
    expect(result.svg).toContain('<svg');
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
});

test('catchHandling hide drops error-handler branches', () => {
    const asl: AslDefinition = {
        StartAt: 'T',
        States: {
            T: {
                Type: 'Task',
                Resource: 'arn:x',
                Next: 'Done',
                Catch: [{ ErrorEquals: ['States.ALL'], Next: 'H' }],
            },
            H: { Type: 'Fail', Error: 'x' },
            Done: { Type: 'Succeed' },
        },
    };
    const shown = generateMermaid({ aslDefinition: asl });
    const hidden = generateMermaid({ aslDefinition: asl, catchHandling: 'hide' });
    expect(shown.code).toContain('H');
    expect(hidden.code).not.toContain(' H\n');
    expect(hidden.metadata.stateCount).toBeLessThan(shown.metadata.stateCount);
});
