import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
    formatMachineLabel,
    makeCdkLogicalId,
    matchStateMachine,
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
