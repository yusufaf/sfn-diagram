import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SfnDiagramGenerator, generateDiff, generateSvg } from '../src';
import type { AslDefinition } from '../src/types';

const loadFixture = (name: string): AslDefinition => {
    const path = join(__dirname, 'fixtures', `${name}.asl.json`);
    return JSON.parse(readFileSync(path, 'utf-8'));
};

const twoPass: AslDefinition = {
    StartAt: 'A',
    States: {
        A: { Type: 'Pass', Next: 'B' },
        B: { Type: 'Pass', End: true },
    },
};

// Wrappers forward optional props as `undefined`; the result must match omitting them.
describe('an explicit undefined option', () => {
    it('generateSvg treats edgeStyle: undefined as omitted', () => {
        expect(
            generateSvg({ aslDefinition: twoPass, edgeStyle: undefined }).svg,
        ).toBe(generateSvg({ aslDefinition: twoPass }).svg);
    });

    it('generateSvg treats catchHandling: undefined as omitted', () => {
        const aslDefinition = loadFixture('error-handling');

        expect(
            generateSvg({ aslDefinition, catchHandling: undefined }).svg,
        ).toBe(generateSvg({ aslDefinition }).svg);
    });

    it('generateDiff treats catchHandling: undefined as omitted', () => {
        const definition = loadFixture('error-handling');

        expect(
            generateDiff({
                after: definition,
                before: definition,
                catchHandling: undefined,
            }).svg,
        ).toBe(generateDiff({ after: definition, before: definition }).svg);
    });

    it('SfnDiagramGenerator.setOptions({ edgeStyle: undefined }) restores the default', () => {
        const generator = new SfnDiagramGenerator({ edgeStyle: 'straight' });

        expect(
            generator
                .setOptions({ edgeStyle: undefined })
                .generateSvg({ aslDefinition: twoPass }).svg,
        ).toBe(
            new SfnDiagramGenerator().generateSvg({ aslDefinition: twoPass })
                .svg,
        );
    });

    // Already green: getTheme drops undefined theme fields. Guards that it stays so.
    it('generateSvg treats undefined nested theme fields as omitted', () => {
        const theme = {
            base: undefined,
            edgeColors: { normal: undefined },
            fontSize: undefined,
            nodeColors: { Pass: { fill: undefined } },
        };

        expect(generateSvg({ aslDefinition: twoPass, theme }).svg).toBe(
            generateSvg({ aslDefinition: twoPass }).svg,
        );
    });
});
