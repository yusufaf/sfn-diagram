import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    assetManifestName,
    findCdkAssetPath,
    findNestedStackTemplates,
    isCdkAssetKey,
} from '../../src/cfn/cdkAsset';

const HASH = 'ab'.repeat(32);

describe('isCdkAssetKey', () => {
    it.each([`${HASH}.json`, `${HASH}.yaml`, HASH, `pre/${HASH}.json`, `pre-${HASH}.json`])(
        'accepts a CDK asset object key: %s',
        (objectKey) => {
            expect(isCdkAssetKey({ objectKey })).toBe(true);
        },
    );

    it.each([
        'workflow.json',
        'abc.json',
        `${'ab'.repeat(16)}.json`,
        `${HASH.toUpperCase()}.json`,
        `${HASH}.json/x`,
    ])('rejects a key CDK would not write: %s', (objectKey) => {
        expect(isCdkAssetKey({ objectKey })).toBe(false);
    });
});

describe('assetManifestName', () => {
    it.each([
        ['cdk.out/Stack.template.json', 'Stack.assets.json'],
        ['C:\\proj\\cdk.out\\assembly-Prod\\ProdStack1.template.json', 'ProdStack1.assets.json'],
        ['Stack.template.json', 'Stack.assets.json'],
    ])('names the manifest beside %s', (templateFileName, expected) => {
        expect(assetManifestName({ templateFileName })).toBe(expected);
    });

    it.each([
        'template.json',
        'template.yaml',
        '.template.json',
        'ParentChild8B49BB45.nested.template.json',
    ])('names no manifest for %s', (templateFileName) => {
        expect(assetManifestName({ templateFileName })).toBeUndefined();
    });
});

describe('findCdkAssetPath', () => {
    const entry = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        destinations: { d: { bucketName: 'b', objectKey: 'abc.json' } },
        source: { packaging: 'file', path: 'asset.abc.json' },
        ...overrides,
    });
    const manifestOf = (fileEntry: Record<string, unknown>): string =>
        JSON.stringify({ files: { abc: fileEntry } });
    const MANIFEST = manifestOf(entry());

    it('returns the source path of the asset published to the object key', () => {
        expect(findCdkAssetPath({ manifest: MANIFEST, objectKey: 'abc.json' })).toBe('asset.abc.json');
    });

    it('matches a prefixed object key against the destination, not the files key', () => {
        const manifest = manifestOf(
            entry({ destinations: { d: { bucketName: 'b', objectKey: 'pre/abc.json' } } }),
        );
        expect(findCdkAssetPath({ manifest, objectKey: 'pre/abc.json' })).toBe('asset.abc.json');
        expect(findCdkAssetPath({ manifest, objectKey: 'abc.json' })).toBeUndefined();
    });

    it('treats an omitted packaging as a file asset', () => {
        const manifest = manifestOf(entry({ source: { path: 'asset.abc.json' } }));
        expect(findCdkAssetPath({ manifest, objectKey: 'abc.json' })).toBe('asset.abc.json');
    });

    it('reads a manifest that starts with a byte order mark', () => {
        expect(
            findCdkAssetPath({ manifest: `${String.fromCharCode(0xfeff)}${MANIFEST}`, objectKey: 'abc.json' }),
        ).toBe('asset.abc.json');
    });

    it.each([
        ['a zip asset', manifestOf(entry({ source: { packaging: 'zip', path: 'asset.abc' } }))],
        ['an executable source', manifestOf(entry({ source: { executable: ['x'] } }))],
        ['no destination with that key', manifestOf(entry({ destinations: { d: { objectKey: 'other.json' } } }))],
        ['text that is not JSON', 'not json'],
        ['a JSON array', '[]'],
        ['an array of files', '{"files":[]}'],
    ])('finds nothing in %s', (_label, manifest) => {
        expect(findCdkAssetPath({ manifest, objectKey: 'abc.json' })).toBeUndefined();
    });
});

describe('findNestedStackTemplates', () => {
    it('lists every nested stack template in a real asset manifest, in order', () => {
        const manifest = readFileSync(
            join(__dirname, '..', 'fixtures', 'cfn', 'cdk-assembly', 'OrdersStack.assets.json'),
            'utf-8',
        );
        expect(findNestedStackTemplates({ manifest })).toEqual([
            'OrdersStackNestedDeeper95288E24.nested.template.json',
            'OrdersStackNestedB84F9012.nested.template.json',
        ]);
    });

    it('skips zip assets and other files', () => {
        const manifest = JSON.stringify({
            files: {
                a: { source: { packaging: 'zip', path: 'A.nested.template.json' } },
                b: { source: { path: 'asset.b.json' } },
                c: { source: { path: 'C.nested.template.json' } },
            },
        });
        expect(findNestedStackTemplates({ manifest })).toEqual(['C.nested.template.json']);
    });

    it('returns [] for text that is not an asset manifest', () => {
        expect(findNestedStackTemplates({ manifest: 'not json' })).toEqual([]);
        expect(findNestedStackTemplates({ manifest: '{"files":[]}' })).toEqual([]);
    });
});
