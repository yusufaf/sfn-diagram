import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateDiff, generateExecution, generateMermaid, generateSvg } from '../src';
import { AUTO_THEME_DARK_CSS } from '../src/config/autoTheme';
import { AWS_DARK_THEME, getTheme } from '../src/config';
import type { AslDefinition, CustomTheme, DiagramOptions } from '../src/types';

const loadAsl = (name: string): AslDefinition =>
    JSON.parse(readFileSync(join(__dirname, 'fixtures', `${name}.asl.json`), 'utf-8'));
const loadHistory = (name: string): string => readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf-8');

/** The auto output with everything auto adds removed: what the light output must equal. */
const stripAuto = (svg: string): string =>
    svg
        .replace(/<style>[^<]*<\/style>/g, '')
        .replace(/ class="sfn-t-[^"]*"/g, '')
        .replace(/ sfn-t-[\w-]+/g, '');

/** Every `.class { prop: value; }` rule of the auto stylesheet. */
const parseRules = (css: string): Map<string, { property: string; value: string }> =>
    new Map(
        [...css.matchAll(/\.([\w-]+) \{ (fill|stroke): ([^;]+); \}/g)].map(([, className, property, value]) => [
            className,
            { property, value },
        ]),
    );

const themedClasses = (svg: string): Set<string> =>
    new Set(svg.replace(/<style>[^<]*<\/style>/, '').match(/sfn-t-[\w-]+/g) ?? []);

describe("theme: 'auto'", () => {
    it('embeds one dark-scheme stylesheet, and only for auto', () => {
        const asl = loadAsl('simple');
        const auto = generateSvg({ aslDefinition: asl, theme: 'auto' }).svg;
        const styles = auto.match(/<style>[^<]*<\/style>/g) ?? [];

        expect(styles).toHaveLength(1);
        expect(styles[0]).toContain('@media (prefers-color-scheme: dark)');
        const custom: CustomTheme = { base: 'dark', fontSize: 16 };
        for (const theme of ['light', 'dark', custom] as const) {
            expect(generateSvg({ aslDefinition: asl, theme }).svg).not.toContain('<style>');
        }
    });

    const cases: Array<[string, () => { auto: string; light: string }]> = [
        ...['simple', 'choice', 'retry', 'self-loop', 'parallel', 'distributed-map', 'nested-map'].map(
            (name): [string, () => { auto: string; light: string }] => [
                name,
                () => ({
                    auto: generateSvg({ aslDefinition: loadAsl(name), theme: 'auto' }).svg,
                    light: generateSvg({ aslDefinition: loadAsl(name), theme: 'light' }).svg,
                }),
            ],
        ),
        ...(
            [
                ['collapsed', { collapse: true }],
                ['collapse controls and hit areas', { collapseControls: true, edgeHitAreas: true }],
            ] as Array<[string, Partial<DiagramOptions>]>
        ).map(([label, options]): [string, () => { auto: string; light: string }] => [
            label,
            () => ({
                auto: generateSvg({ aslDefinition: loadAsl('parallel'), ...options, theme: 'auto' }).svg,
                light: generateSvg({ aslDefinition: loadAsl('parallel'), ...options, theme: 'light' }).svg,
            }),
        ]),
        [
            'execution overlay',
            () => {
                const params = { aslDefinition: loadAsl('retry'), history: loadHistory('execution-retry-success') };
                return {
                    auto: generateExecution({ ...params, theme: 'auto' }).svg,
                    light: generateExecution({ ...params, theme: 'light' }).svg,
                };
            },
        ],
        [
            'execution overlay with dimmed edges',
            () => {
                const params = { aslDefinition: loadAsl('choice'), history: loadHistory('execution-choice-highvalue') };
                return {
                    auto: generateExecution({ ...params, theme: 'auto' }).svg,
                    light: generateExecution({ ...params, theme: 'light' }).svg,
                };
            },
        ],
        [
            'diff overlay',
            () => {
                const params = { after: loadAsl('diff-nested-after'), before: loadAsl('diff-nested-before') };
                return {
                    auto: generateDiff({ ...params, theme: 'auto' }).svg,
                    light: generateDiff({ ...params, theme: 'light' }).svg,
                };
            },
        ],
    ];

    it.each(cases)('is the light output plus classes and a stylesheet (%s)', (_label, render) => {
        const { auto, light } = render();
        expect(auto).not.toBe(light);
        expect(stripAuto(auto)).toBe(light);
    });

    it.each(cases)('has a dark rule in the dark palette for every class it uses (%s)', (_label, render) => {
        const rules = parseRules(AUTO_THEME_DARK_CSS);
        const dark = AWS_DARK_THEME;
        const expected = (className: string): string | undefined => {
            if (className === 'sfn-t-bg-fill') return dark.background;
            if (className === 'sfn-t-text-fill' || className === 'sfn-t-text-stroke') return dark.textColor;
            const node = /^sfn-t-node-(\w+)-(fill|stroke)$/.exec(className);
            if (node) return dark.nodeColors[node[1] as keyof typeof dark.nodeColors][node[2] as 'fill' | 'stroke'];
            const edge = /^sfn-t-edge-(\w+)-(fill|stroke)$/.exec(className);
            if (edge) return dark.edgeColors[edge[1] as keyof typeof dark.edgeColors];
            return undefined;
        };

        const classes = themedClasses(render().auto);
        expect(classes.size).toBeGreaterThan(0);
        for (const className of classes) {
            expect(rules.get(className)?.value, className).toBe(expected(className));
            expect(rules.get(className)?.property, className).toBe(className.endsWith('-stroke') ? 'stroke' : 'fill');
        }
    });

    it('leaves nodeOverrides, edgeOverrides and customColors colours untagged', () => {
        const asl: AslDefinition = {
            StartAt: 'A',
            States: {
                A: { Type: 'Pass', Next: 'B' },
                B: { Type: 'Task', Resource: 'arn:aws:lambda:us-east-1:123:function:b', Next: 'C' },
                C: { Type: 'Succeed' },
            },
        };
        const svg = generateSvg({
            aslDefinition: asl,
            customColors: { Task: { fill: '#abcdef' } },
            edgeOverrides: { 'B->C': { stroke: '#2e7d32' } },
            nodeOverrides: { A: { fill: '#123456' } },
            theme: 'auto',
        }).svg;

        const shapeOf = (stateId: string): string => {
            const start = svg.indexOf(`data-state-id="${stateId}"`);
            return /<(?:rect|circle|path) [^>]*>/.exec(svg.slice(start))![0];
        };
        expect(shapeOf('A')).toContain('class="sfn-t-node-Pass-stroke"');
        expect(shapeOf('B')).toContain('class="sfn-t-node-Task-stroke"');
        // The embedded stylesheet names every class, so look at the markup only.
        const markup = svg.replace(/<style>[^<]*<\/style>/, '');
        expect(markup).not.toContain('sfn-t-node-Pass-fill');
        expect(markup).not.toContain('sfn-t-node-Task-fill');

        const overridden = /<path [^>]*data-edge-id="B-&gt;C[^"]*"[^>]*>/.exec(svg)![0];
        expect(overridden).not.toContain('class=');
        const markerId = /marker-end="url\(#([^)]+)\)"/.exec(overridden)![1];
        expect(markerId).toMatch(/^arrowhead-override-/);
        const marker = new RegExp(`<marker id="${markerId}"[^>]*><polygon [^>]*>`).exec(svg)![0];
        expect(marker).not.toContain('class=');
    });

    it('gives an override equal to the light type colour its own fixed arrowhead', () => {
        const asl: AslDefinition = { StartAt: 'A', States: { A: { Type: 'Pass', Next: 'B' }, B: { Type: 'Succeed' } } };
        const normal = getTheme('light').edgeColors.normal;
        const options = { aslDefinition: asl, edgeOverrides: { 'A->B': { stroke: normal } } };

        expect(generateSvg({ ...options, theme: 'light' }).svg).toContain('marker-end="url(#arrowhead-normal)"');
        expect(generateSvg({ ...options, theme: 'auto' }).svg).toContain('marker-end="url(#arrowhead-override-0)"');
    });

    it('builds a stylesheet that needs no text escaping', () => {
        expect(AUTO_THEME_DARK_CSS).not.toMatch(/[<>&]/);
    });

    it('resolves to the light theme', () => {
        expect(getTheme('auto')).toBe(getTheme('light'));
    });

    it('renders Mermaid exactly as light', () => {
        const asl = loadAsl('choice');
        expect(generateMermaid({ aslDefinition: asl, theme: 'auto' }).code).toBe(
            generateMermaid({ aslDefinition: asl, theme: 'light' }).code,
        );
    });
});
