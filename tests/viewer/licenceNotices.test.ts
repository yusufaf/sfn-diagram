import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateHtml } from '../../src/html';
import type { AslDefinition } from '../../src/types';

/**
 * A document that ships the relayout bundle carries copies of dagre (MIT) and of the
 * d3-shape port in src/utils/linePath.ts (ISC). Both licences require their notice in
 * every copy, and the minifier drops legal comments, so the build writes them into a
 * banner. These checks keep a build change from silently dropping it.
 */

const repoRoot = join(__dirname, '..', '..');

function readFixture(name: string): AslDefinition {
    return JSON.parse(readFileSync(join(repoRoot, 'tests', 'fixtures', name), 'utf-8')) as AslDefinition;
}

/**
 * Every non-blank line of a licence file. The banner keeps each line intact behind a
 * ` * ` prefix, so each one must appear verbatim.
 */
function licenceLines(licenceFile: string): string[] {
    return readFileSync(join(repoRoot, licenceFile), 'utf-8')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

describe('third-party licence notices in generated HTML', () => {
    const withRelayout = generateHtml({ aslDefinition: readFixture('parallel.asl.json') }).html;

    it('ships the relayout bundle for a definition with containers', () => {
        expect(withRelayout).toContain('sfnRelayout');
    });

    it.each([
        { copyright: 'Copyright (c) 2012-2014 Chris Pettitt', licence: 'node_modules/@dagrejs/dagre/LICENSE' },
        { copyright: 'Copyright 2010-2022 Mike Bostock', licence: 'node_modules/d3-shape/LICENSE' },
    ])('includes $copyright and every line of its licence', ({ copyright, licence }) => {
        expect(withRelayout).toContain(copyright);
        for (const line of licenceLines(licence)) {
            expect(withRelayout).toContain(line);
        }
    });
});
