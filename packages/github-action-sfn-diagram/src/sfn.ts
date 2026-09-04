// Thin re-export: the actual implementation moved to the shared `sfn-diagram/ci`
// subpath (src/ci/execution.ts in the core package) so the GitLab integration
// gets execution overlays too. Kept as its own module here (rather than
// importing 'sfn-diagram/ci' directly from run.ts) so `run.test.ts` can mock
// execution fetching independently of the rest of the shared report builder.
export { fetchExecutionForOverlay } from 'sfn-diagram/ci'
export type {
    ExecutionMode,
    FetchExecutionForOverlayParams,
    OverlayExecution,
} from 'sfn-diagram/ci'
