import { describe, expect, it } from 'vitest';
import { resolveOptionalPeerVersion } from '../../scripts/resolve-optional-peer-version.mjs';

const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      yaml:
        specifier: ^2.9.0
        version: 2.9.1
    devDependencies:
      '@resvg/resvg-js':
        specifier: ^2.6.2
        version: 2.6.2
      node-html-to-image:
        specifier: ^6.2.0
        version: 6.2.0
`;

describe('resolveOptionalPeerVersion', () => {
    it('resolves a devDependencies entry to its exact locked version', () => {
        expect(
            resolveOptionalPeerVersion({
                lockfileContents: LOCKFILE,
                packageName: '@resvg/resvg-js',
            }),
        ).toBe('2.6.2');
    });

    it('resolves a dependencies entry too', () => {
        expect(
            resolveOptionalPeerVersion({ lockfileContents: LOCKFILE, packageName: 'yaml' }),
        ).toBe('2.9.1');
    });

    // The whole point of #153: a peer that is silently absent produces an image
    // that fails at runtime. Fail the build instead.
    it('throws when the package is not in the root importer', () => {
        expect(() =>
            resolveOptionalPeerVersion({ lockfileContents: LOCKFILE, packageName: 'sharp' }),
        ).toThrow(/not found in the root importer/);
    });

    it('throws when the lockfile has no root importer', () => {
        expect(() =>
            resolveOptionalPeerVersion({ lockfileContents: 'importers:\n', packageName: 'yaml' }),
        ).toThrow(/no root importer/);
    });
});
