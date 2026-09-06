// Resolves a release tag to the version (plus its major and major.minor
// prefixes) that .github/workflows/docker.yml tags the ghcr.io image with.
//
// Only the core `sfn-diagram` package's tags are accepted: the current
// `sfn-diagram-v<semver>` scheme and the four legacy no-hyphen `v<semver>`
// tags from before that scheme existed (v0.2.0, v0.3.0, v0.4.0, v0.4.1).
// Every other release-please component tag (github-action-sfn-diagram-v*,
// sfn-diagram-react-v*, vscode-sfn-diagram-v*) contains a hyphen before its
// own `-v`, so it is rejected here rather than silently mis-parsed - see
// https://github.com/yusufaf/sfn-diagram/issues/127, where
// vscode-sfn-diagram-v0.1.1 was stripped down to "scode-sfn-diagram-v0.1.1"
// and pushed to the registry under that garbage tag.
//
// Usage:
//   node scripts/resolve-docker-tag.mjs --tag sfn-diagram-v1.6.0
// Appends version=/major=/minor= to $GITHUB_OUTPUT, or exits 1 with a
// message on an unrecognized tag.
//
// No shebang: unlike the other scripts in this directory, this one is
// imported directly by tests/ci/resolveDockerTag.test.ts, and a shebang line
// followed by CRLF endings (what a Windows checkout of this repo produces,
// with no .gitattributes forcing LF) breaks esbuild's shebang-stripping
// regex during that import - it is never invoked as an executable itself.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const LEGACY_TAGS = new Set(['v0.2.0', 'v0.3.0', 'v0.4.0', 'v0.4.1']);
const SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

/**
 * @typedef {object} ResolveDockerTagParams
 * @property {string} tag - The git tag to resolve, e.g. `sfn-diagram-v1.6.0`
 */

/**
 * Resolve a release tag to the version and its major/major.minor prefixes, for the
 * four `type=raw` Docker tags docker.yml pushes to ghcr.io - rejecting any tag that
 * isn't the core `sfn-diagram` package's, rather than silently mis-parsing it into
 * a garbage tag (see #127).
 *
 * @param {ResolveDockerTagParams} params
 * @returns {{ major: string, minor: string, version: string }}
 * @throws if `tag` isn't a core sfn-diagram release tag, or its version isn't a semver
 *
 * @example
 * resolveDockerTag({ tag: 'sfn-diagram-v1.6.0' });
 * // { major: '1', minor: '1.6', version: '1.6.0' }
 */
export function resolveDockerTag(params) {
    const { tag } = params;

    let version;
    if (tag.startsWith('sfn-diagram-v')) {
        version = tag.slice('sfn-diagram-v'.length);
    } else if (LEGACY_TAGS.has(tag)) {
        version = tag.slice('v'.length);
    } else {
        throw new Error(
            `resolveDockerTag: unrecognized tag "${tag}" - expected sfn-diagram-v<semver> ` +
                `or one of the legacy tags (${[...LEGACY_TAGS].join(', ')})`,
        );
    }

    if (!SEMVER.test(version)) {
        throw new Error(
            `resolveDockerTag: tag "${tag}" resolved to "${version}", which is not a semver`,
        );
    }

    const major = version.split('.')[0];
    const minor = version.split('.').slice(0, 2).join('.');
    return { major, minor, version };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
    const { values } = parseArgs({
        options: { tag: { type: 'string' } },
        strict: true,
    });

    if (!values.tag) {
        console.error('usage: resolve-docker-tag.mjs --tag <release-tag>');
        process.exit(1);
    }

    try {
        const { major, minor, version } = resolveDockerTag({ tag: values.tag });
        const githubOutput = process.env.GITHUB_OUTPUT;
        if (githubOutput) {
            appendFileSync(githubOutput, `version=${version}\nmajor=${major}\nminor=${minor}\n`);
        }
        console.log(`version=${version} major=${major} minor=${minor}`);
    } catch (error) {
        console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
