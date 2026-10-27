/**
 * Compile-time checks that the structural types the core declares in place of
 * `@aws-sdk/client-sfn`'s still match it. No entry point imports this file, so
 * it reaches neither `dist/` nor a consumer's program; `pnpm run typecheck`
 * runs it, and a failed check shows up as a type error here.
 *
 * @module
 */
import type {
    DescribeStateMachineCommandOutput,
    GetExecutionHistoryCommandOutput,
    HistoryEvent,
    HistoryEventType,
} from '@aws-sdk/client-sfn';
import type { KnownHistoryEventType } from '../execution';
import type {
    ExecutionHistoryEvent,
    ExecutionHistoryPage,
    StateMachineDescription,
} from './index';

type Assert<Condition extends true> = Condition;
type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type IsNever<Keys> = [Keys] extends [never] ? true : false;

/** The `*EventDetails` keys typed as objects rather than `unknown`: the ones whose nested keys must match too. */
type PreciselyTypedDetailsKey = {
    [Key in keyof ExecutionHistoryEvent]-?: unknown extends ExecutionHistoryEvent[Key]
        ? never
        : Key extends `${string}EventDetails`
          ? Key
          : never;
}[keyof ExecutionHistoryEvent];

/** SDK keys a precisely typed details object leaves out, per key (the conditional distributes over the union). */
type MissingNestedKeys<Key extends keyof ExecutionHistoryEvent & keyof HistoryEvent> = Key extends unknown
    ? Exclude<keyof NonNullable<HistoryEvent[Key]>, keyof NonNullable<ExecutionHistoryEvent[Key]>>
    : never;

export type AwsSdkCompatChecks = [
    // SDK objects pass straight in.
    Assert<IsAssignable<HistoryEvent, ExecutionHistoryEvent>>,
    Assert<IsAssignable<GetExecutionHistoryCommandOutput, ExecutionHistoryPage>>,
    Assert<IsAssignable<DescribeStateMachineCommandOutput, StateMachineDescription>>,
    // Every SDK field, top-level and inside each precisely typed details object, is
    // declared, so object literals written against the SDK pass excess-property checks.
    Assert<IsNever<Exclude<keyof HistoryEvent, keyof ExecutionHistoryEvent>>>,
    Assert<IsNever<Exclude<keyof GetExecutionHistoryCommandOutput, keyof ExecutionHistoryPage>>>,
    Assert<IsNever<Exclude<keyof DescribeStateMachineCommandOutput, keyof StateMachineDescription>>>,
    Assert<IsNever<MissingNestedKeys<PreciselyTypedDetailsKey>>>,
    // Every event type name the core matches on is one AWS emits.
    Assert<IsAssignable<KnownHistoryEventType, HistoryEventType>>,
];
