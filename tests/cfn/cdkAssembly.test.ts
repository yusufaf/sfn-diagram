import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCloudAssemblyManifest } from '../../src/cfn/cdkAssembly';

// Real `cdk synth` output (aws-cdk-lib 2.274.0, manifest schema 55.0.0) with the feature-flag
// report, the validation report and the `*.metadata.json` files removed.
const ASSEMBLY = join(__dirname, '..', 'fixtures', 'cfn', 'cdk-assembly');

const manifestAt = (...parts: string[]): string =>
    readFileSync(join(ASSEMBLY, ...parts, 'manifest.json'), 'utf-8');

describe('readCloudAssemblyManifest', () => {
    it('reads the stacks and Stage assemblies of a real top-level manifest', () => {
        expect(readCloudAssemblyManifest({ manifest: manifestAt() })).toEqual({
            nestedAssemblies: ['assembly-Prod'],
            stacks: [
                {
                    displayName: 'OrdersStack',
                    id: 'OrdersStack',
                    templateFile: 'OrdersStack.template.json',
                },
                {
                    displayName: 'EmptyStack',
                    id: 'EmptyStack',
                    templateFile: 'EmptyStack.template.json',
                },
            ],
        });
    });

    it('reads a Stage manifest, with its own nested Stage', () => {
        expect(readCloudAssemblyManifest({ manifest: manifestAt('assembly-Prod') })).toEqual({
            nestedAssemblies: ['assembly-Prod-Eu'],
            stacks: [
                {
                    displayName: 'Prod/OrdersStack',
                    id: 'ProdOrdersStack2EDBF9CE',
                    templateFile: 'ProdOrdersStack2EDBF9CE.template.json',
                },
            ],
        });
    });

    it('ignores the schema version and fields it does not read', () => {
        const manifest = JSON.stringify({
            artifacts: {
                Next: { future: true, properties: { templateFile: 'Next.template.json' }, type: 'aws:cloudformation:stack' },
            },
            unknown: 1,
            version: '99.0.0',
        });
        expect(readCloudAssemblyManifest({ manifest })).toEqual({
            nestedAssemblies: [],
            stacks: [{ id: 'Next', templateFile: 'Next.template.json' }],
        });
    });

    it('skips a stack without templateFile and an assembly without directoryName', () => {
        const manifest = JSON.stringify({
            artifacts: {
                A: { properties: {}, type: 'aws:cloudformation:stack' },
                B: { properties: { directoryName: '' }, type: 'cdk:cloud-assembly' },
                C: { properties: { file: 'C.assets.json' }, type: 'cdk:asset-manifest' },
            },
        });
        expect(readCloudAssemblyManifest({ manifest })).toEqual({ nestedAssemblies: [], stacks: [] });
    });

    it.each(['not json', '[]', '{}', '{"name":"my-app","version":"1.0.0"}', '{"artifacts":[]}'])(
        'returns undefined for %s, which is not a cloud assembly manifest',
        (manifest) => {
            expect(readCloudAssemblyManifest({ manifest })).toBeUndefined();
        },
    );

    it('returns empty lists for an assembly with no artifacts', () => {
        expect(readCloudAssemblyManifest({ manifest: '{"artifacts":{}}' })).toEqual({
            nestedAssemblies: [],
            stacks: [],
        });
    });
});
