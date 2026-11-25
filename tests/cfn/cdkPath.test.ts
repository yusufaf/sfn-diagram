import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
    formatMachineLabel,
    makeCdkLogicalId,
    matchStateMachine,
    matchStateMachines,
    matchStateMachinesInTemplates,
    readCdkPath,
    toConstructPath,
    type StateMachineCandidate,
} from '../../src/cfn/cdkPath';

const nodeMd5 = (text: string): string => createHash('md5').update(text, 'utf8').digest('hex');

/** The three state machines of a real `cdk synth` of `OrdersStack` (aws-cdk-lib 2.274.0). */
const ORDERS_STACK: readonly StateMachineCandidate[] = [
    { cdkPath: 'OrdersStack/OrderWorkflow/Resource', logicalId: 'OrderWorkflow0015CDD9' },
    { cdkPath: 'OrdersStack/Orders/Workflow/Resource', logicalId: 'OrdersWorkflow5B5F4FE8' },
    { cdkPath: 'OrdersStack/Orders/Raw', logicalId: 'OrdersRawA5B3A6B2' },
];

describe('readCdkPath', () => {
    it('returns the aws:cdk:path metadata value', () => {
        expect(readCdkPath({ metadata: { 'aws:cdk:path': 'S/Flow/Resource' } })).toBe(
            'S/Flow/Resource',
        );
    });

    it.each([
        ['missing metadata', undefined],
        ['null metadata', null],
        ['non-object metadata', 'S/Flow/Resource'],
        ['no path key', { 'aws:cdk:other': 'x' }],
        ['a non-string path', { 'aws:cdk:path': 42 }],
        ['an empty path', { 'aws:cdk:path': '' }],
    ])('returns undefined for %s', (_label, metadata) => {
        expect(readCdkPath({ metadata })).toBeUndefined();
    });
});

describe('toConstructPath', () => {
    it.each([
        ['OrdersStack/OrderWorkflow/Resource', 'OrdersStack/OrderWorkflow'],
        ['OrdersStack/Orders/Default', 'OrdersStack/Orders'],
        ['OrdersStack/Orders/Raw', 'OrdersStack/Orders/Raw'],
        ['A/Resource/Resource', 'A/Resource'],
    ])('turns %s into %s', (cdkPath, expected) => {
        expect(toConstructPath({ cdkPath })).toBe(expected);
    });
});

describe('makeCdkLogicalId', () => {
    it.each([
        [['OrderWorkflow', 'Resource'], 'OrderWorkflow0015CDD9'],
        [['RefundWorkflow', 'Resource'], 'RefundWorkflow9F22E5E9'],
        [['Orders', 'Workflow', 'Resource'], 'OrdersWorkflow5B5F4FE8'],
        [['Orders', 'Raw'], 'OrdersRawA5B3A6B2'],
        [['NestedWorkflow', 'Resource'], 'NestedWorkflowF6BC47A2'],
        [['My-Machine'], 'MyMachine'],
    ])('reproduces the logical ID CDK gives %j', (components, expected) => {
        expect(makeCdkLogicalId({ components })).toBe(expected);
    });

    it('returns undefined when only Default components remain', () => {
        expect(makeCdkLogicalId({ components: ['Default'] })).toBeUndefined();
        expect(makeCdkLogicalId({ components: [] })).toBeUndefined();
    });

    it('ignores Default components, in the hash as well as the readable part', () => {
        expect(makeCdkLogicalId({ components: ['Orders', 'Default', 'Raw'] })).toBe(
            makeCdkLogicalId({ components: ['Orders', 'Raw'] }),
        );
    });

    it('drops a component that the previous one already ends with from the readable part', () => {
        const logicalId = makeCdkLogicalId({
            components: ['Orders', 'Orders', 'Workflow', 'Resource'],
        });
        const hash = nodeMd5('Orders/Orders/Workflow/Resource').slice(0, 8).toUpperCase();
        expect(logicalId).toBe(`OrdersWorkflow${hash}`);
    });

    it('hashes a single component whose readable form is longer than 255 characters', () => {
        const component = 'A'.repeat(256);
        const hash = nodeMd5(component).slice(0, 8).toUpperCase();
        expect(makeCdkLogicalId({ components: [component] })).toBe(`${'A'.repeat(240)}${hash}`);
    });
});

describe('formatMachineLabel', () => {
    it('shows the construct path next to the logical ID', () => {
        expect(formatMachineLabel({ machine: ORDERS_STACK[0] })).toBe(
            'OrderWorkflow0015CDD9 (OrdersStack/OrderWorkflow)',
        );
        expect(formatMachineLabel({ machine: ORDERS_STACK[2] })).toBe(
            'OrdersRawA5B3A6B2 (OrdersStack/Orders/Raw)',
        );
    });

    it('shows the bare logical ID without metadata', () => {
        expect(formatMachineLabel({ machine: { logicalId: 'OrderWorkflow0015CDD9' } })).toBe(
            'OrderWorkflow0015CDD9',
        );
    });
});

describe('matchStateMachine', () => {
    const match = (resourceId: string, machines = ORDERS_STACK): string | undefined =>
        matchStateMachine({ machines, resourceId })?.logicalId;

    it.each([
        ['OrderWorkflow0015CDD9', 'OrderWorkflow0015CDD9'],
        ['OrdersStack/OrderWorkflow/Resource', 'OrderWorkflow0015CDD9'],
        ['OrdersStack/OrderWorkflow', 'OrderWorkflow0015CDD9'],
        ['/OrdersStack/OrderWorkflow', 'OrderWorkflow0015CDD9'],
        ['OrderWorkflow', 'OrderWorkflow0015CDD9'],
        ['Orders/Workflow', 'OrdersWorkflow5B5F4FE8'],
        ['Orders/Raw', 'OrdersRawA5B3A6B2'],
        ['Workflow', 'OrdersWorkflow5B5F4FE8'],
    ])('resolves %s to %s', (resourceId, expected) => {
        expect(match(resourceId)).toBe(expected);
    });

    it('returns undefined when nothing matches', () => {
        expect(match('Nope')).toBeUndefined();
        expect(match('Orders//Workflow')).toBeUndefined();
    });

    it('prefers an exact logical ID over a computed one', () => {
        const machines: StateMachineCandidate[] = [
            { logicalId: 'OrderWorkflow' },
            { cdkPath: 'S/OrderWorkflow/Resource', logicalId: 'OrderWorkflow0015CDD9' },
        ];
        expect(match('OrderWorkflow', machines)).toBe('OrderWorkflow');
        expect(match('OrderWorkflow0015CDD9', machines)).toBe('OrderWorkflow0015CDD9');
    });

    it('prefers a stack-relative path over a path suffix', () => {
        const machines: StateMachineCandidate[] = [
            { cdkPath: 'S/Workflow/Resource', logicalId: 'Workflow193EF7C1' },
            { cdkPath: 'S/Orders/Workflow/Resource', logicalId: 'OrdersWorkflow5B5F4FE8' },
        ];
        expect(match('Workflow', machines)).toBe('Workflow193EF7C1');
    });

    it('throws listing the candidates when a suffix matches more than one machine', () => {
        const machines: StateMachineCandidate[] = [
            { cdkPath: 'S/A/Flow/Resource', logicalId: 'AFlowE02A3768' },
            { cdkPath: 'S/B/Flow/Resource', logicalId: 'BFlowF1F7FEAE' },
        ];
        expect(() => match('Flow', machines)).toThrow(
            /more than one.*AFlowE02A3768.*BFlowF1F7FEAE/s,
        );
    });

    it('throws when a full path and a stack-relative path name different machines', () => {
        const machines: StateMachineCandidate[] = [
            { cdkPath: 'Orders/Workflow/Resource', logicalId: 'Workflow193EF7C1' },
            { cdkPath: 'Orders/Orders/Workflow/Resource', logicalId: 'OrdersWorkflow5B5F4FE8' },
        ];
        expect(() => match('Orders/Workflow', machines)).toThrow(
            /more than one.*Workflow193EF7C1.*OrdersWorkflow5B5F4FE8/s,
        );
    });

    it('resolves a stack-relative path without metadata', () => {
        const machines: StateMachineCandidate[] = ORDERS_STACK.map(({ logicalId }) => ({
            logicalId,
        }));
        expect(match('OrderWorkflow', machines)).toBe('OrderWorkflow0015CDD9');
        expect(match('Orders/Workflow', machines)).toBe('OrdersWorkflow5B5F4FE8');
        expect(match('OrdersStack/OrderWorkflow', machines)).toBeUndefined();
    });
});

/** The seven state machines of the `tests/fixtures/cfn/cdk-assembly` cloud assembly, by template. */
const ASSEMBLY_TEMPLATES: ReadonlyArray<readonly StateMachineCandidate[]> = [
    [{ cdkPath: 'OrdersStack/OrderWorkflow/Resource', logicalId: 'OrderWorkflow0015CDD9' }],
    [{ cdkPath: 'OrdersStack/Nested/NestedWorkflow/Resource', logicalId: 'NestedWorkflowF6BC47A2' }],
    [{ cdkPath: 'OrdersStack/Nested/Deeper/DeepWorkflow/Resource', logicalId: 'DeepWorkflowBD8A9795' }],
    [{ cdkPath: 'Prod/OrdersStack/OrderWorkflow/Resource', logicalId: 'OrderWorkflow0015CDD9' }],
    [
        {
            cdkPath: 'Prod/OrdersStack/Nested/NestedWorkflow/Resource',
            logicalId: 'NestedWorkflowF6BC47A2',
        },
    ],
    [{ cdkPath: 'Prod/Eu/Svc/W/Resource', logicalId: 'W8F2A5E99' }],
];
const ASSEMBLY_MACHINES = ASSEMBLY_TEMPLATES.flat();

describe('matchStateMachines', () => {
    const paths = (resourceId: string, machines = ASSEMBLY_MACHINES): Array<string | undefined> =>
        matchStateMachines({ machines, resourceId }).map((machine) => machine.cdkPath);

    it('keeps only the best tier across the candidates it is given', () => {
        expect(paths('OrdersStack/OrderWorkflow')).toEqual(['OrdersStack/OrderWorkflow/Resource']);
        expect(paths('OrdersStack/Nested/NestedWorkflow')).toEqual([
            'OrdersStack/Nested/NestedWorkflow/Resource',
        ]);
    });

    it('returns every match in the winning tier instead of throwing', () => {
        expect(paths('OrderWorkflow')).toEqual([
            'OrdersStack/OrderWorkflow/Resource',
            'Prod/OrdersStack/OrderWorkflow/Resource',
        ]);
        expect(paths('OrderWorkflow0015CDD9')).toHaveLength(2);
    });

    it('returns [] when nothing matches', () => {
        expect(paths('Nope')).toEqual([]);
    });

    it("returns the caller's own objects", () => {
        const machine = { cdkPath: 'S/A/Resource', extra: 1, logicalId: 'A' };
        expect(matchStateMachines({ machines: [machine], resourceId: 'A' })[0]).toBe(machine);
    });
});

describe('matchStateMachinesInTemplates', () => {
    const paths = (
        resourceId: string,
        templates = ASSEMBLY_TEMPLATES,
    ): Array<string | undefined> =>
        matchStateMachinesInTemplates({ resourceId, templates }).map((machine) => machine.cdkPath);

    it('lets an exact construct path win over another stack’s trailing-part match', () => {
        expect(paths('OrdersStack/OrderWorkflow')).toEqual(['OrdersStack/OrderWorkflow/Resource']);
        expect(paths('/OrdersStack/OrderWorkflow')).toEqual(['OrdersStack/OrderWorkflow/Resource']);
        expect(paths('Prod/Eu/Svc/W/Resource')).toEqual(['Prod/Eu/Svc/W/Resource']);
    });

    it('keeps each stack’s match for a shorter path or a shared logical ID', () => {
        expect(paths('OrderWorkflow')).toEqual([
            'OrdersStack/OrderWorkflow/Resource',
            'Prod/OrdersStack/OrderWorkflow/Resource',
        ]);
        expect(paths('OrderWorkflow0015CDD9')).toHaveLength(2);
        expect(paths('Nope')).toEqual([]);
    });

    it('keeps machines at different depths in different stacks', () => {
        const shallow: StateMachineCandidate = {
            cdkPath: 'OrdersStack/Workflow/Resource',
            logicalId: makeCdkLogicalId({ components: ['Workflow', 'Resource'] }) ?? '',
        };
        const deep: StateMachineCandidate = {
            cdkPath: 'PaymentsStack/Refunds/Workflow/Resource',
            logicalId: 'RefundsWorkflow36009061',
        };
        expect(paths('Workflow', [[shallow], [deep]])).toEqual([shallow.cdkPath, deep.cdkPath]);
        expect(paths('Workflow', [[shallow, deep]])).toEqual([shallow.cdkPath]);
        expect(paths('OrdersStack/Workflow', [[shallow], [deep]])).toEqual([shallow.cdkPath]);
    });
});
