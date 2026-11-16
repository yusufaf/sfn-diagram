#!/usr/bin/env node
// Compiles the built bin entry (dist/bin.js) into standalone executables with
// `bun build --compile`, so users without Node can run `sfn-diagram` from a
// single downloaded file. The npm package is untouched; this only produces
// release assets.
//
// Run via `pnpm run build:binary` after `pnpm run build`. Requires `bun` on PATH
// (CI uses oven-sh/setup-bun). Output lands in binaries/ as
// sfn-diagram-<os>-<arch>[.exe].
//
// Usage:
//   node scripts/build-binaries.mjs                 # every target below
//   node scripts/build-binaries.mjs --target bun-linux-x64 [--target ...]
//   node scripts/build-binaries.mjs --target host   # the current platform only
//
// The binary differs from the npm CLI in two ways, both signalled through the
// `__SFN_DIAGRAM_BUILD__` global that src/cli.ts checks: the version is baked
// in (there is no package.json next to a compiled binary), and `--format png`
// is disabled because the native rasterizer it needs cannot be bundled into a
// single-file executable.
//
// The binary inlines third-party packages (dagre, minimatch, yaml, …) whose
// licences require their notice in every copy, and most carry it only in a
// LICENSE file that bun leaves behind. So a quick non-compile bun pass first
// lists what gets bundled, and the entry module then opens with a `/*!` comment
// holding every one of those notices, which bun keeps in the executable. A
// package with no licence file fails the build. tests/binaryLicenceNotices.test.ts
// checks a built binary (CI runs it on every binary it builds).
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const binPath = path.join(root, 'dist/bin.js');
const outDir = path.join(root, 'binaries');
const entryPath = path.join(outDir, 'entry.generated.mjs');
const analysisJs = path.join(outDir, 'notices.analysis.js');
const analysisJson = path.join(outDir, 'notices.analysis.json');

// LICENSE, LICENCE.md, LICENSE-MIT, NOTICE, COPYING, …; never a source file such
// as license.js.
const LICENCE_FILE =
    /^(licen[cs]e|copying|notice)(-[a-z0-9]+)?(\.(md|markdown|txt))?$/i;
const MARKER = 'node_modules/';

const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/** bun `--target` name -> release asset name (without the Windows extension). */
const TARGETS = {
    'bun-darwin-arm64': 'sfn-diagram-darwin-arm64',
    'bun-darwin-x64': 'sfn-diagram-darwin-x64',
    'bun-linux-arm64': 'sfn-diagram-linux-arm64',
    'bun-linux-x64': 'sfn-diagram-linux-x64',
    'bun-windows-x64': 'sfn-diagram-windows-x64',
};

/**
 * Packages that must stay out of the bundle. Both are optional peers, which a
 * single-file executable has no node_modules to load from, so src/cli.ts refuses
 * every flag that needs one before taking the dynamic import:
 *
 * - `@resvg/resvg-js` is reached only through the PNG exporter. Its napi loader
 *   `require`s one platform package per target and only the host's is ever
 *   installed.
 * - `@aws-sdk/client-sfn` is reached by `--from-aws`, `--diff <arn>`,
 *   `--execution <arn>` and `comment gitlab --execution-mode`. Bundling it cost
 *   about 1 MB and 150 modules per binary for routes the binary refuses (#341).
 *
 * bun hoists a static import of an external out of every module it inlines, even
 * one reached only through `import()`, so the binary would then resolve it at
 * startup and fail on every command. No module the CLI reaches may therefore import
 * one of these statically; tests/coreDependencies.test.ts enforces that.
 */
const EXTERNALS = ['@aws-sdk/client-sfn', '@resvg/resvg-js'];

function hostTarget() {
    const os = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[
        process.platform
    ];
    const arch = { arm64: 'arm64', x64: 'x64' }[process.arch];
    const target = os && arch ? `bun-${os}-${arch}` : undefined;
    if (!target || !(target in TARGETS)) {
        throw new Error(
            `No standalone binary target for ${process.platform}/${process.arch}`,
        );
    }
    return target;
}

function resolveTargets(requested) {
    if (requested.length === 0) {
        return Object.keys(TARGETS);
    }
    return requested.map((target) => {
        const resolved = target === 'host' ? hostTarget() : target;
        if (!(resolved in TARGETS)) {
            throw new Error(
                `Unknown target "${target}". Known: ${Object.keys(TARGETS).join(', ')}, host`,
            );
        }
        return resolved;
    });
}

function readVersion() {
    const packageJsonPath = path.join(root, 'package.json');
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')).version;
}

/**
 * Each third-party package bun's metafile shows was bundled, with its licence
 * text: the licence files in the package root and in every directory between an
 * inlined file and that root. Keyed by the full path through the last
 * node_modules/, so two copies of one package stay apart. bun writes the input
 * paths relative to the directory it ran in, which is `root`.
 *
 * @param {{ metafile: { inputs: Record<string, unknown> } }} params - The parsed bun metafile.
 * @returns {{ files: string[], id: string, text: string }[]} One entry per bundled package, sorted by id.
 * @throws if a package ships no licence file, or its licence would end the notice comment early.
 */
function bundledPackages({ metafile }) {
    const subdirsByRoot = new Map();
    for (const input of Object.keys(metafile.inputs)) {
        const index = input.lastIndexOf(MARKER);
        if (index === -1) {
            continue;
        }
        const segments = input.slice(index + MARKER.length).split('/');
        const nameLength = segments[0].startsWith('@') ? 2 : 1;
        const packageRoot =
            input.slice(0, index + MARKER.length) +
            segments.slice(0, nameLength).join('/');
        const subdirs = subdirsByRoot.get(packageRoot) ?? new Set(['']);
        const inner = segments.slice(nameLength, -1);
        for (let depth = 1; depth <= inner.length; depth++) {
            subdirs.add(inner.slice(0, depth).join('/'));
        }
        subdirsByRoot.set(packageRoot, subdirs);
    }
    return [...subdirsByRoot]
        .map(([packageRoot, subdirs]) => {
            const dir = path.join(root, packageRoot);
            const manifest = JSON.parse(
                readFileSync(path.join(dir, 'package.json'), 'utf8'),
            );
            const id = `${manifest.name}@${manifest.version}`;
            const files = [...subdirs]
                .filter((subdir) => existsSync(path.join(dir, subdir)))
                .flatMap((subdir) =>
                    readdirSync(path.join(dir, subdir))
                        // statSync follows symlinks: a symlinked LICENSE counts, a directory doesn't.
                        .filter(
                            (file) =>
                                LICENCE_FILE.test(file) &&
                                statSync(path.join(dir, subdir, file)).isFile(),
                        )
                        .map((file) => (subdir ? `${subdir}/${file}` : file)),
                )
                .sort(byCodeUnit);
            const text = files
                .map((file) =>
                    readFileSync(path.join(dir, file), 'utf8')
                        .replace(/\r\n/g, '\n')
                        .trim(),
                )
                .join('\n\n');
            if (!text) {
                throw new Error(`${id} ships no licence file`);
            }
            if (text.includes('*/')) {
                throw new Error(
                    `${id}'s licence contains "*/", which would end the notice comment early`,
                );
            }
            return { files, id, text };
        })
        .sort((left, right) => byCodeUnit(left.id, right.id));
}

/**
 * One block comment with every package's notice, packages sharing identical
 * licence text listed together.
 *
 * @param {{ packages: { id: string, text: string }[] }} params - The bundled packages.
 * @returns {string} The `/*! … *\/` comment.
 * @throws if `packages` is empty: the binary always inlines dagre, so finding
 * nothing means the metafile's format changed, not that there is nothing to credit.
 */
function thirdPartyNotice({ packages }) {
    if (packages.length === 0) {
        throw new Error(
            "bun's metafile lists no node_modules packages, but the binary inlines dagre at least; has bun's metafile format changed?",
        );
    }
    const idsByText = new Map();
    for (const pkg of packages) {
        idsByText.set(pkg.text, [...(idsByText.get(pkg.text) ?? []), pkg.id]);
    }
    const lines = [
        '/*! Third-party software bundled into this file, with the notices their licences require.',
        ' *',
    ];
    for (const [text, ids] of idsByText) {
        lines.push(` * ${[...new Set(ids)].join(', ')}:`, ' *');
        lines.push(
            ...text
                .split('\n')
                .map((line) =>
                    line.trimEnd() ? ` * ${line.trimEnd()}` : ' *',
                ),
        );
        lines.push(' *');
    }
    lines.push(' */');
    return lines.join('\n');
}

// The build constant is injected through a tiny entry module rather than bun's
// `--define`, so the JSON value never has to survive shell quoting (this script
// runs on Windows too). A dynamic import keeps the assignment ahead of the bin
// entry's module body, which runs immediately on import; a static import would
// be hoisted above it. The licence notice rides at the top of the same module.
function writeEntry({ notice, version }) {
    writeFileSync(
        entryPath,
        [
            ...(notice ? [notice, ''] : []),
            '// GENERATED by scripts/build-binaries.mjs - not committed.',
            `globalThis.__SFN_DIAGRAM_BUILD__ = ${JSON.stringify({ standalone: true, version })};`,
            "await import('../dist/bin.js');",
            '',
        ].join('\n'),
    );
}

/**
 * Run bun from the repo root.
 *
 * @param {{ args: string[], label: string }} params - bun's arguments, and what the run is for in error messages.
 * @returns {boolean} Whether bun ran and exited 0.
 */
function runBun({ args, label }) {
    // Windows resolves the npm-installed `bun` through a .cmd shim, which
    // needs a shell. With `shell: true` Node joins the arguments without
    // quoting, so the absolute paths are quoted by hand in case the checkout
    // lives under a directory with a space in its name.
    const useShell = process.platform === 'win32';
    const shellArgs = useShell
        ? args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg))
        : args;
    const result = spawnSync('bun', shellArgs, {
        cwd: root,
        shell: useShell,
        stdio: 'inherit',
    });
    if (result.error) {
        console.error(
            `build-binaries: could not run bun: ${result.error.message}`,
        );
        return false;
    }
    if (result.status !== 0) {
        console.error(
            `build-binaries: bun exited with ${result.status} for ${label}`,
        );
        return false;
    }
    return true;
}

const { values } = parseArgs({
    options: {
        target: { multiple: true, short: 't', type: 'string' },
    },
    strict: true,
});

if (!existsSync(binPath)) {
    console.error(
        `build-binaries: ${binPath} not found - run \`pnpm run build\` first.`,
    );
    process.exit(1);
}

const targets = resolveTargets(values.target ?? []);
const version = readVersion();

mkdirSync(outDir, { recursive: true });

const externalArgs = EXTERNALS.flatMap((name) => ['--external', name]);

let failed = false;
try {
    // A stale metafile from an interrupted run must never stand in for this one.
    rmSync(analysisJs, { force: true });
    rmSync(analysisJson, { force: true });
    writeEntry({ notice: '', version });
    if (
        !runBun({
            args: [
                'build',
                '--target=bun',
                ...externalArgs,
                entryPath,
                `--outfile=${analysisJs}`,
                `--metafile=${analysisJson}`,
            ],
            label: 'the notice analysis pass',
        })
    ) {
        failed = true;
    } else {
        const metafile = JSON.parse(readFileSync(analysisJson, 'utf8'));
        writeEntry({
            notice: thirdPartyNotice({
                packages: bundledPackages({ metafile }),
            }),
            version,
        });
    }

    if (!failed) {
        for (const target of targets) {
            const assetName =
                TARGETS[target] +
                (target.startsWith('bun-windows') ? '.exe' : '');
            const outfile = path.join(outDir, assetName);
            console.log(`build-binaries: ${target} -> binaries/${assetName}`);
            if (
                !runBun({
                    args: [
                        'build',
                        '--compile',
                        `--target=${target}`,
                        ...externalArgs,
                        entryPath,
                        `--outfile=${outfile}`,
                    ],
                    label: target,
                })
            ) {
                failed = true;
                break;
            }
        }
    }
} finally {
    rmSync(entryPath, { force: true });
    rmSync(analysisJs, { force: true });
    rmSync(analysisJson, { force: true });
}

process.exit(failed ? 1 : 0);
