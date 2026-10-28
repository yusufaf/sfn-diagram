import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { lintAsl } from '../src/lint';
import {
    jsonataDefinition,
    jsonPathDefinition,
} from './fixtures/asl-type-coverage';
import { COMPILE_TIMEOUT_MS, typeErrorsIn } from './helpers/typeErrorsIn';

const repoRoot = resolve(__dirname, '..');

describe('ASL definition types', () => {
    it(
        'accept a JSONPath and a JSONata definition using every field AWS documents, without a cast',
        () => {
            expect(
                typeErrorsIn({
                    fileName: join(
                        repoRoot,
                        'tests/fixtures/asl-type-coverage.ts',
                    ),
                }),
            ).toEqual([]);
        },
        COMPILE_TIMEOUT_MS,
    );

    it.each([
        ['JSONPath', jsonPathDefinition],
        ['JSONata', jsonataDefinition],
    ])('the %s fixture is real, lint-clean ASL', (_label, definition) => {
        expect(lintAsl({ definition })).toEqual([]);
    });

    // Proves the first test can fail: a misspelled field must still be rejected,
    // so the type check above is not a silent no-op.
    it.each([
        [
            'RetryBlock',
            "import type { RetryBlock } from '../src/types';\nexport const retry: RetryBlock = { ErrorEquals: ['States.ALL'], MaxDelaySecond: 5 };",
            "'MaxDelaySecond' does not exist in type 'RetryBlock'",
        ],
        [
            'CatchBlock',
            "import type { CatchBlock } from '../src/types';\nexport const catcher: CatchBlock = { ErrorEquals: ['States.ALL'], Outputs: 1 };",
            "'Outputs' does not exist in type 'CatchBlock'",
        ],
        [
            'ReaderConfig',
            "import type { ReaderConfig } from '../src/types';\nexport const reader: ReaderConfig = { CSVHeader: [] };",
            "'CSVHeader' does not exist in type 'ReaderConfig'",
        ],
    ])(
        'still rejects a misspelled %s field',
        (_label, sourceText, message) => {
            expect(
                typeErrorsIn({
                    fileName: join(repoRoot, 'tests', '__aslTypes.snippet.ts'),
                    sourceText,
                }),
            ).toEqual([expect.stringContaining(message)]);
        },
        COMPILE_TIMEOUT_MS,
    );
});
