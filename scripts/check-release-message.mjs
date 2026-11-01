// Fails when release-please cannot parse the squash message a PR would merge with.
//
// release-please parses each commit on main with `@conventional-commits/parser`, which is
// stricter than `conventional-commits-parser` (what commitlint uses): a body line that
// starts with `identifier(` reads as the opening of a scope and the parse dies at the line
// break. release-please swallows that into a debug log and drops the commit from the
// release PR - #362's `feat` vanished that way and #353 said 1.8.1 (#387). So this runs
// release-please's own `parseConventionalCommits` and treats any swallowed failure, or an
// empty result, as a failure. Going through that entry point rather than the parser also
// applies the same `BEGIN_COMMIT_OVERRIDE` / `BEGIN_NESTED_COMMIT` handling a release run does.
// It also fails when a `!` sits only in a commit bullet: release-please reads only the
// squash subject's header, so the MAJOR bump and its changelog note would vanish.
//
// The message checked is the one GitHub builds by default for this repo's squash settings
// (PR title + `* <commit message>` per commit). A message hand-edited in the merge dialog
// is not seen.
//
// Usage:
//   node scripts/check-release-message.mjs --pr <number>
//   node scripts/check-release-message.mjs --message-file <file> [--body-file <file>]
// Exits 1 and prints the parse error when the message would be dropped.
//
// No shebang: imported directly by tests/ci/checkReleaseMessage.test.ts (see
// scripts/lib/cliScript.mjs for why).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseConventionalCommits } from 'release-please/build/src/commit.js';
import { runAsScript } from './lib/cliScript.mjs';

const HINT =
    'Do not start a body line with `identifier(` - indent the code or wrap it in backticks. ' +
    'To bypass, add a BEGIN_COMMIT_OVERRIDE ... END_COMMIT_OVERRIDE block to the PR body.';

// A column-0 `* type!:` line, as GitHub writes each commit of a multi-commit squash.
// No `\s*`: with the `m` flag it would also match across newlines.
const BREAKING_BULLET = /^\* [a-z]+(\([^)]*\))?!:/m;

const BREAKING_HINT =
    'Put `!` in the PR title (or in the commit, for a single-commit PR); ' +
    '`gh pr merge --body "BREAKING CHANGE: <migration>"` then adds the migration note. ' +
    'To keep it non-breaking on purpose, add a BEGIN_COMMIT_OVERRIDE ... END_COMMIT_OVERRIDE block to the PR body.';

/**
 * @typedef {object} BuildSquashMessageParams
 * @property {string[]} commits - Full message of each commit on the PR, oldest first.
 * @property {string} title - The PR title.
 */

/**
 * Rebuild the message GitHub gives a squash merge under the repo's
 * `COMMIT_OR_PR_TITLE` + `COMMIT_MESSAGES` settings.
 *
 * @param {BuildSquashMessageParams} params - The PR title and its commit messages.
 * @returns {string} The squash commit message.
 */
export function buildSquashMessage(params) {
    const { commits, title } = params;
    if (commits.length === 1) return commits[0];
    return [title, ...commits.map((commit) => `* ${commit}`)].join('\n\n');
}

/**
 * @typedef {object} CheckReleaseMessageParams
 * @property {string} message - The squash commit message.
 * @property {string} [prBody] - The PR body; release-please prefers a
 *   `BEGIN_COMMIT_OVERRIDE` block in it over the message.
 */

/**
 * Parse `message` the way release-please does.
 *
 * @param {CheckReleaseMessageParams} params - The message and optional PR body.
 * @returns {{ breakingDropped: boolean, errors: string[], ok: boolean, parsedCount: number }}
 *   `ok` is false when the parse failed, produced no conventional commit, or would drop a
 *   breaking change. `breakingDropped` is true when a `!` sits only in a commit bullet and
 *   no override block replaces the message.
 */
export function checkReleaseMessage(params) {
    const { message, prBody } = params;
    const errors = [];
    const logger = {
        debug: (line) => {
            if (String(line).startsWith('error message:')) errors.push(String(line).slice(15));
        },
    };
    const parsed = parseConventionalCommits(
        [
            {
                files: [],
                message,
                pullRequest: prBody === undefined ? undefined : { body: prBody },
                sha: 'squash',
            },
        ],
        logger,
    );
    if (errors.length === 0 && parsed.length === 0) {
        errors.push('no conventional commit found - the header must be `type(scope): subject`');
    }
    // Same split as release-please's preprocessCommitMessage, so it agrees with `parsed`.
    const overridden = Boolean(
        prBody && (prBody.split('BEGIN_COMMIT_OVERRIDE')[1] ?? '').split('END_COMMIT_OVERRIDE')[0].trim(),
    );
    const breakingDropped =
        errors.length === 0 &&
        !overridden &&
        !parsed.some((commit) => commit.breaking) &&
        BREAKING_BULLET.test(message);
    if (breakingDropped) {
        errors.push('a `type!:` header sits in a commit bullet, which release-please ignores');
    }
    return { breakingDropped, errors, ok: errors.length === 0, parsedCount: parsed.length };
}

function loadPullRequest(number) {
    const raw = execFileSync('gh', ['pr', 'view', number, '--json', 'title,body,commits'], {
        encoding: 'utf8',
    });
    const { body, commits, title } = JSON.parse(raw);
    return {
        message: buildSquashMessage({
            commits: commits.map((commit) =>
                [commit.messageHeadline, commit.messageBody].filter(Boolean).join('\n\n'),
            ),
            title,
        }),
        prBody: body ?? undefined,
    };
}

await runAsScript({
    importMetaUrl: import.meta.url,
    main: (values) => {
        if (!values.pr && !values['message-file']) {
            throw new Error('pass --pr <number> or --message-file <file>');
        }
        const { message, prBody } = values.pr
            ? loadPullRequest(values.pr)
            : {
                  message: readFileSync(values['message-file'], 'utf8'),
                  prBody: values['body-file'] && readFileSync(values['body-file'], 'utf8'),
              };
        const result = checkReleaseMessage({ message, prBody });
        if (result.breakingDropped) {
            console.error(
                `release-please would drop this breaking change:\n  ${result.errors.join('\n  ')}\n${BREAKING_HINT}`,
            );
            process.exitCode = 1;
            return;
        }
        if (!result.ok) {
            console.error(`release-please cannot parse this squash message:\n  ${result.errors.join('\n  ')}\n${HINT}`);
            process.exitCode = 1;
            return;
        }
        console.log(`ok: release-please parses ${result.parsedCount} commit(s)`);
    },
    options: {
        'body-file': { type: 'string' },
        'message-file': { type: 'string' },
        pr: { type: 'string' },
    },
    usage: 'check-release-message.mjs --pr <number> | --message-file <file> [--body-file <file>]',
});
