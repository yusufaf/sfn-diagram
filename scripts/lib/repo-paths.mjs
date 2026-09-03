/**
 * Shared path/fixture-loading helpers for the image-generating scripts
 * (generate-doc-images.mjs, generate-gallery-images.mjs, generate-og-image.mjs)
 * so the three don't each reimplement the same few lines and drift apart.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the repo root from a script's own `import.meta.url`.
 *
 * @param {string} scriptUrl - `import.meta.url` of a file directly under `scripts/`.
 * @returns {string} Absolute path to the repo root.
 */
export function repoRootFrom(scriptUrl) {
    return join(dirname(fileURLToPath(scriptUrl)), '..');
}

/**
 * Load and parse an ASL fixture from `tests/fixtures/<name>.asl.json`.
 *
 * @param {string} repoRoot - Absolute repo root, from {@link repoRootFrom}.
 * @param {string} name - Fixture name, without the `.asl.json` extension.
 * @returns {unknown} The parsed ASL definition.
 */
export function readAslFixture(repoRoot, name) {
    const fixturePath = join(repoRoot, 'tests', 'fixtures', `${name}.asl.json`);
    return JSON.parse(readFileSync(fixturePath, 'utf-8'));
}
