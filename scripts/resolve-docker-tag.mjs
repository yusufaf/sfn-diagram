#!/usr/bin/env node
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
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const LEGACY_TAGS = new Set(['v0.2.0', 'v0.3.0', 'v0.4.0', 'v0.4.1']);
const SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

/**
 * @param {{ tag: string }} params
 * @returns {{ major: string, minor: string, version: string }}
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
