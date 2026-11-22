import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ReadFileParams } from './types';

/** Parameters for {@link readBesideTemplate}. */
interface ReadBesideTemplateParams {
    /** The directory the template was read from. */
    directory: string;
    /** The path as the template writes it. */
    path: string;
}

/**
 * Read a file a template points at, relative to the template's directory. Only a regular
 * file is read: a directory, FIFO or device such as `/dev/zero` could hang or exhaust
 * memory. Errors name the path and the reason, never the contents.
 */
function readBesideTemplate(params: ReadBesideTemplateParams): string {
    const absolutePath = resolve(params.directory, params.path);
    try {
        if (!statSync(absolutePath).isFile()) {
            throw new Error(`${absolutePath} is not a file`);
        }
        return readFileSync(absolutePath, 'utf-8');
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            throw new Error(`${absolutePath} does not exist`, { cause: error });
        }
        if (code === undefined) {
            throw error;
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`cannot read ${absolutePath}: ${reason}`, { cause: error });
    }
}

/** Parameters for {@link createTemplateFileReader}. */
export interface CreateTemplateFileReaderParams {
    /** The template file, absolute or relative to the working directory. */
    templatePath: string;
}

/**
 * Build the `readFile` callback `extractAslFromTemplate` uses for a SAM `DefinitionUri`:
 * it reads a path the template writes relative to the template's own directory, not the
 * working directory. Front ends hand it over on a `RenderDefinitionInput` for a template
 * that came from a file, and pass `null` for stdin, `serve` and inline text.
 *
 * @param params - The template file the paths are relative to.
 * @returns The reader. It throws `<absolute path> does not exist`, `<absolute path> is not
 * a file` or `cannot read <absolute path>: <reason>`.
 *
 * @example
 * ```typescript
 * const readFile = createTemplateFileReader({ templatePath: 'template.yaml' });
 * readFile({ path: 'statemachine/order.asl.json' }); // reads ./statemachine/order.asl.json
 * ```
 */
export function createTemplateFileReader(
    params: CreateTemplateFileReaderParams,
): (params: ReadFileParams) => string {
    const directory = dirname(resolve(params.templatePath));
    return ({ path }) => readBesideTemplate({ directory, path });
}
