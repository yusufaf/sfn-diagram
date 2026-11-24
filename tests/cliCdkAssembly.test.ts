import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { cloudAssemblyOutputStem, expandCloudAssembly } from '../src/cliCdkAssembly';
import { CliInputError, toPosix } from '../src/cliInputs';

// Real `cdk synth` output (aws-cdk-lib 2.274.0, manifest schema 55.0.0) with the feature-flag
// report, the validation report and the `*.metadata.json` files removed. OrdersStack has an
// inline machine, a `fromFile` one and two nested stacks; Stage Prod holds OrdersStack again
// and a nested Stage Prod/Eu with stack Svc.
const ASSEMBLY = join(__dirname, 'fixtures', 'cfn', 'cdk-assembly');

const ALL_STEMS = [
    'OrdersStack.Nested.Deeper.DeepWorkflow',
    'OrdersStack.Nested.NestedWorkflow',
    'OrdersStack.OrderWorkflow',
    'OrdersStack.Refund',
    'Prod.Eu.Svc.W',
    'Prod.OrdersStack.Nested.NestedWorkflow',
    'Prod.OrdersStack.OrderWorkflow',
];

const expand = (resource: string | null = null, directory = ASSEMBLY) =>
    expandCloudAssembly({ directory, resource }) ?? [];

const stems = (resource: string | null = null, directory = ASSEMBLY): string[] =>
    expand(resource, directory).map((machine) => machine.outputStem);

const thrownMessage = (action: () => unknown): string => {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(CliInputError);
        return (error as Error).message;
    }
    throw new Error('expected the call to throw');
};

describe('expandCloudAssembly', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = mkdtempSync(join(tmpdir(), 'sfn-cdk-assembly-'));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    /** A copy of the fixture to change, with `edit` applied to the named file's text. */
    const copyWith = (file?: string, edit?: (text: string) => string): string => {
        const copy = join(tempDir, 'cdk.out');
        cpSync(ASSEMBLY, copy, { recursive: true });
        if (file !== undefined && edit !== undefined) {
            writeFileSync(join(copy, file), edit(readFileSync(join(copy, file), 'utf-8')));
        }
        return copy;
    };

    const editJson = (file: string, edit: (json: Record<string, unknown>) => void): string =>
        copyWith(file, (text) => {
            const json = JSON.parse(text) as Record<string, unknown>;
            edit(json);
            return JSON.stringify(json);
        });

    it('finds every machine in stacks, Stages and nested stacks, sorted by name', () => {
        const machines = expand();
        expect(machines.map((machine) => machine.outputStem)).toEqual(ALL_STEMS);
        expect(machines.map((machine) => machine.name)).toEqual([
            'OrdersStack/Nested/Deeper/DeepWorkflow',
            'OrdersStack/Nested/NestedWorkflow',
            'OrdersStack/OrderWorkflow',
            'OrdersStack/Refund',
            'Prod/Eu/Svc/W',
            'Prod/OrdersStack/Nested/NestedWorkflow',
            'Prod/OrdersStack/OrderWorkflow',
        ]);
        expect(machines.map((machine) => machine.logicalId)).toEqual([
            'DeepWorkflowBD8A9795',
            'NestedWorkflowF6BC47A2',
            'OrderWorkflow0015CDD9',
            'Refund532F98F3',
            'W8F2A5E99',
            'NestedWorkflowF6BC47A2',
            'OrderWorkflow0015CDD9',
        ]);
        expect(machines[5].templatePath).toBe(
            toPosix(join(ASSEMBLY, 'assembly-Prod/ProdOrdersStackNested21266590.nested.template.json')),
        );
        expect(machines[4].templatePath).toBe(
            toPosix(join(ASSEMBLY, 'assembly-Prod/assembly-Prod-Eu/ProdEuSvc4F47E18E.template.json')),
        );
        expect(machines.every((machine) => machine.assembly === ASSEMBLY)).toBe(true);
        expect(machines[2].template).toContain('OrderWorkflow0015CDD9');
    });

    it('filters by --resource across stacks', () => {
        expect(stems('OrderWorkflow')).toEqual([
            'OrdersStack.OrderWorkflow',
            'Prod.OrdersStack.OrderWorkflow',
        ]);
        expect(stems('Prod/OrdersStack/OrderWorkflow')).toEqual(['Prod.OrdersStack.OrderWorkflow']);
        expect(stems('OrdersStack/OrderWorkflow')).toEqual(['OrdersStack.OrderWorkflow']);
        expect(stems('OrdersStack/Nested/NestedWorkflow')).toEqual([
            'OrdersStack.Nested.NestedWorkflow',
        ]);
        expect(stems('/Prod/Eu/Svc/W/Resource')).toEqual(['Prod.Eu.Svc.W']);
    });

    it('lists every construct path when --resource matches nothing', () => {
        const message = thrownMessage(() => expand('Nope'));
        expect(message).toContain("No state machine in cloud assembly");
        expect(message).toContain("matches --resource 'Nope'");
        expect(message).toContain('OrdersStack/Refund');
        expect(message).toContain('Prod/Eu/Svc/W');
    });

    it('keeps machines that match at different depths in different stacks', () => {
        const copy = editJson('OrdersStack.template.json', (template) => {
            const resources = template.Resources as Record<string, Record<string, unknown>>;
            resources.GroupW12345678 = {
                ...resources.OrderWorkflow0015CDD9,
                Metadata: { 'aws:cdk:path': 'OrdersStack/Group/W/Resource' },
            };
        });
        expect(stems('W', copy)).toEqual(['OrdersStack.Group.W', 'Prod.Eu.Svc.W']);
    });

    it('keeps a relative directory relative without joining it twice', () => {
        const directory = relative(process.cwd(), ASSEMBLY);
        const machines = expand(null, directory);
        expect(machines).toHaveLength(7);
        for (const machine of machines) {
            expect(machine.templatePath.startsWith(toPosix(directory))).toBe(true);
            expect(readFileSync(machine.templatePath, 'utf-8')).toContain(machine.logicalId);
        }
    });

    describe('without path metadata', () => {
        const copyWithoutPaths = (): string => {
            const copy = copyWith();
            for (const file of [
                'OrdersStack.template.json',
                'OrdersStackNestedB84F9012.nested.template.json',
                'OrdersStackNestedDeeper95288E24.nested.template.json',
                'assembly-Prod/ProdOrdersStack2EDBF9CE.template.json',
                'assembly-Prod/ProdOrdersStackNested21266590.nested.template.json',
                'assembly-Prod/assembly-Prod-Eu/ProdEuSvc4F47E18E.template.json',
            ]) {
                const path = join(copy, file);
                const template = JSON.parse(readFileSync(path, 'utf-8')) as {
                    Resources: Record<string, { Metadata?: unknown }>;
                };
                for (const resource of Object.values(template.Resources)) {
                    delete resource.Metadata;
                }
                writeFileSync(path, JSON.stringify(template));
            }
            return copy;
        };

        it('names machines by stack and logical ID', () => {
            const found = stems(null, copyWithoutPaths());
            expect(found).toContain('OrdersStack.OrderWorkflow0015CDD9');
            expect(found).toContain('OrdersStackNestedB84F9012.NestedWorkflowF6BC47A2');
            expect(found).toContain('Prod.OrdersStack.OrderWorkflow0015CDD9');
            expect(found).toContain('Prod.Eu.Svc.W8F2A5E99');
        });

        it('accepts the names it lists as --resource', () => {
            const copy = copyWithoutPaths();
            expect(stems('Prod/OrdersStack/OrderWorkflow0015CDD9', copy)).toEqual([
                'Prod.OrdersStack.OrderWorkflow0015CDD9',
            ]);
            expect(stems('OrderWorkflow0015CDD9', copy)).toEqual([
                'OrdersStack.OrderWorkflow0015CDD9',
                'Prod.OrdersStack.OrderWorkflow0015CDD9',
            ]);
            expect(thrownMessage(() => expand('Nope', copy))).toContain(
                'OrdersStack/OrderWorkflow0015CDD9',
            );
        });
    });

    it('drops a byte order mark from template text', () => {
        const bom = String.fromCharCode(0xfeff);
        const copy = copyWith(
            'assembly-Prod/assembly-Prod-Eu/ProdEuSvc4F47E18E.template.json',
            (text) => bom + text,
        );
        const [machine] = expand('Prod/Eu/Svc/W', copy);
        expect(machine.logicalId).toBe('W8F2A5E99');
        expect(machine.template.startsWith(bom)).toBe(false);
    });

    it('returns null for a directory that is not a cloud assembly', () => {
        expect(expandCloudAssembly({ directory: tempDir, resource: null })).toBeNull();
        writeFileSync(join(tempDir, 'manifest.json'), '{"name":"web-app"}');
        expect(expandCloudAssembly({ directory: tempDir, resource: null })).toBeNull();
    });

    it('refuses a Stage assembly whose manifest is not one', () => {
        const copy = copyWith('assembly-Prod/manifest.json', () => '{}');
        expect(thrownMessage(() => expand(null, copy))).toContain(
            'is not a CDK cloud assembly manifest',
        );
    });

    it('names a template the manifest lists but that is missing', () => {
        const copy = editJson('manifest.json', (manifest) => {
            const artifacts = manifest.artifacts as Record<string, { properties: Record<string, unknown> }>;
            artifacts.EmptyStack.properties.templateFile = 'Missing.template.json';
        });
        expect(thrownMessage(() => expand(null, copy))).toContain(
            `${join(resolve(copy), 'Missing.template.json')} does not exist`,
        );
    });

    it('skips nested stack discovery when a stack has no asset manifest', () => {
        const copy = copyWith();
        rmSync(join(copy, 'OrdersStack.assets.json'));
        const found = stems(null, copy);
        expect(found).toContain('OrdersStack.OrderWorkflow');
        expect(found.some((stem) => stem.startsWith('OrdersStack.Nested.'))).toBe(false);
    });

    it('visits a Stage directory only once', () => {
        const copy = editJson('manifest.json', (manifest) => {
            const artifacts = manifest.artifacts as Record<string, unknown>;
            artifacts.Self = { properties: { directoryName: '.' }, type: 'cdk:cloud-assembly' };
        });
        expect(stems(null, copy)).toEqual(ALL_STEMS);
    });

    it.each([
        ['a Stage directory', 'manifest.json', 'assembly-Prod', 'directoryName', '//host/share'],
        ['a template', 'manifest.json', 'OrdersStack', 'templateFile', '\\\\host\\x.template.json'],
    ])('refuses a network path for %s', (_label, file, artifact, property, value) => {
        const copy = editJson(file, (manifest) => {
            const artifacts = manifest.artifacts as Record<string, { properties: Record<string, unknown> }>;
            artifacts[artifact].properties[property] = value;
        });
        expect(thrownMessage(() => expand(null, copy))).toContain('network or device path');
    });

    it('refuses a network path for a nested stack template', () => {
        const copy = editJson('OrdersStack.assets.json', (manifest) => {
            const files = manifest.files as Record<string, unknown>;
            files.remote = { source: { packaging: 'file', path: '\\\\host\\X.nested.template.json' } };
        });
        expect(thrownMessage(() => expand(null, copy))).toContain('network or device path');
    });

    it('reads a nested template path written with backslashes', () => {
        const copy = editJson('OrdersStack.assets.json', (manifest) => {
            const files = manifest.files as Record<string, unknown>;
            files.sub = { source: { packaging: 'file', path: 'sub\\X.nested.template.json' } };
        });
        mkdirSync(join(copy, 'sub'));
        cpSync(
            join(copy, 'OrdersStackNestedB84F9012.nested.template.json'),
            join(copy, 'sub', 'X.nested.template.json'),
        );
        const machines = expand('OrdersStack/Nested/NestedWorkflow', copy);
        expect(machines.map((machine) => machine.templatePath)).toContain(
            toPosix(join(copy, 'sub/X.nested.template.json')),
        );
    });

    it('does not echo a template that is not JSON', () => {
        const copy = copyWith('EmptyStack.template.json', () => 'not json {secret}');
        const message = thrownMessage(() => expand(null, copy));
        expect(message).toContain('is not valid JSON');
        expect(message).not.toContain('secret');
    });

    it('says so when the assembly has no state machine', () => {
        writeFileSync(
            join(tempDir, 'manifest.json'),
            JSON.stringify({
                artifacts: {
                    EmptyStack: {
                        properties: { templateFile: 'EmptyStack.template.json' },
                        type: 'aws:cloudformation:stack',
                    },
                },
            }),
        );
        cpSync(join(ASSEMBLY, 'EmptyStack.template.json'), join(tempDir, 'EmptyStack.template.json'));
        expect(thrownMessage(() => expand(null, tempDir))).toContain(
            'has no AWS::StepFunctions::StateMachine or AWS::Serverless::StateMachine resource in its 1 templates',
        );
    });
});

describe('cloudAssemblyOutputStem', () => {
    it('joins the construct path with dots', () => {
        expect(
            cloudAssemblyOutputStem({
                cdkPath: 'Prod/OrdersStack/OrderWorkflow/Resource',
                logicalId: 'OrderWorkflow0015CDD9',
                stackName: 'Prod/OrdersStack',
            }),
        ).toBe('Prod.OrdersStack.OrderWorkflow');
    });

    it('falls back to the stack name and logical ID', () => {
        expect(cloudAssemblyOutputStem({ logicalId: 'W8F2A5E99', stackName: 'Prod/Eu/Svc' })).toBe(
            'Prod.Eu.Svc.W8F2A5E99',
        );
    });

    it('replaces characters a filename cannot hold', () => {
        expect(
            cloudAssemblyOutputStem({
                cdkPath: `App/Stack/Bad:Name*${String.fromCharCode(1)}/Resource`,
                logicalId: 'X',
                stackName: 'App/Stack',
            }),
        ).toBe('App.Stack.Bad_Name__');
    });

    it('drops trailing dots and spaces, and falls back to the logical ID when nothing is left', () => {
        expect(
            cloudAssemblyOutputStem({ cdkPath: 'App/Stack/Name. /Resource', logicalId: 'X', stackName: 'S' }),
        ).toBe('App.Stack.Name');
        expect(cloudAssemblyOutputStem({ cdkPath: '/Resource', logicalId: 'X1', stackName: 'S' })).toBe('X1');
    });
});
