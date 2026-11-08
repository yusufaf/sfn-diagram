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

/** The licence's permission paragraph, joined onto one line as the banner reflows nothing. */
function permissionNotice(licenceFile: string): string {
    const text = readFileSync(join(repoRoot, licenceFile), 'utf-8').replace(/\r\n/g, '\n');
    return text.split('\n\n')[1].split('\n')[0];
}

describe('third-party licence notices in generated HTML', () => {
    const withRelayout = generateHtml({ aslDefinition: readFixture('parallel.asl.json') }).html;

    it('ships the relayout bundle for a definition with containers', () => {
        expect(withRelayout).toContain('sfnRelayout');
    });

    it.each([
        { copyright: 'Copyright (c) 2012-2014 Chris Pettitt', licence: 'node_modules/@dagrejs/dagre/LICENSE' },
        { copyright: 'Copyright 2010-2022 Mike Bostock', licence: 'node_modules/d3-shape/LICENSE' },
    ])('includes $copyright and its permission notice', ({ copyright, licence }) => {
        expect(withRelayout).toContain(copyright);
        expect(withRelayout).toContain(permissionNotice(licence));
    });
});
