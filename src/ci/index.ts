/**
 * @module
 *
 * Node-only CI/PR integration building blocks for `sfn-diagram` (the
 * `sfn-diagram/ci` subpath): a platform-neutral Markdown report builder, an
 * execution-overlay fetcher, and a full GitLab merge request integration.
 * Powers both the `sfn-diagram comment gitlab` CLI subcommand and the GitHub
 * Action (`packages/github-action-sfn-diagram`), which layers its own
 * `pull_request`-event handling and octokit calls on top of the same report
 * builder.
 *
 * Isolated from the core entry so importing `sfn-diagram` never pulls in
 * `@aws-sdk/client-sfn` or shells out to `git`.
 *
 * @example
 * ```ts
 * import { runGitlabComment } from 'sfn-diagram/ci';
 *
 * const { exitCode, logs } = await runGitlabComment({
 *   aslGlob: '**\/*.asl.json,**\/*.asl',
 *   commentTag: 'sfn-diagram-preview',
 *   executionMode: 'off',
 *   outputDir: 'sfn-diagram-artifacts',
 *   stateMachineArn: '',
 *   theme: 'light',
 * });
 * ```
 */
export {
    assembleCommentBody,
    buildAslFileSection,
    buildExecutionOverlaySection,
    DEFAULT_REPORT_FOOTER,
    DEFAULT_REPORT_HEADING,
    formatStateList,
    isAslDefinition,
    matchesPatterns,
    parseAslJson,
    renderAslFileSection,
    renderExecutionOverlaySection,
} from './buildReport';
export type {
    AslFileChange,
    AslFileSection,
    AssembleCommentBodyParams,
    BuildExecutionOverlaySectionParams,
    BuildExecutionOverlaySectionResult,
    ExecutionOverlaySection,
    OverlayCandidate,
} from './buildReport';

export {
    getChangedAslFiles,
    readFileAtGitRef,
    readWorkingTreeFile,
} from './changedFiles';
export type { ChangedAslFile, GetChangedAslFilesParams } from './changedFiles';

export { fetchExecutionForOverlay } from './execution';
export type {
    ExecutionMode,
    FetchExecutionForOverlayParams,
    OverlayExecution,
} from './execution';

export {
    detectGitlabMergeRequestContext,
    MAX_INLINE_MERMAID_CHARS,
    resolveGitlabToken,
    runGitlabComment,
    upsertMergeRequestNote,
} from './gitlab';
export type {
    GitlabMergeRequestContext,
    RunGitlabCommentParams,
    RunGitlabCommentResult,
    UpsertMergeRequestNoteParams,
    UpsertMergeRequestNoteResult,
} from './gitlab';
