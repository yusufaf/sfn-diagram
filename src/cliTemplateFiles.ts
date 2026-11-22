import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
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
 * The largest file read beside a template. A Step Functions definition (or CDK asset
 * manifest) is far smaller; the cap stops a template from pointing at a multi-gigabyte log
 * and loading it into memory.
 */
const MAX_DEFINITION_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Read a file a template points at, relative to the template's directory. Only a regular
 * file of at most {@link MAX_DEFINITION_FILE_BYTES} is read: a directory, FIFO or device
 * such as `/dev/zero` could hang, and a huge file would exhaust memory. Errors name the path
 * and the reason, never the contents.
 *
 * The file is opened once and checked through that descriptor, so the file checked is the
 * file read, even if the path is swapped in between. The open is non-blocking where the
 * platform has the flag: opening a FIFO for reading would otherwise wait for a writer.
 */
function readBesideTemplate(params: ReadBesideTemplateParams): string {
    const absolutePath = resolve(params.directory, params.path);
    let descriptor: number | undefined;
    try {
        descriptor = openSync(absolutePath, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
        const stats = fstatSync(descriptor);
        if (!stats.isFile()) {
            throw new Error(`${absolutePath} is not a file`);
        }
        if (stats.size > MAX_DEFINITION_FILE_BYTES) {
            throw new Error(
                `${absolutePath} is ${stats.size} bytes, over the ${MAX_DEFINITION_FILE_BYTES}-byte limit for a definition file`,
            );
        }
        return readFileSync(descriptor, 'utf-8');
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            throw new Error(`${absolutePath} does not exist`, { cause: error });
        }
        // Windows refuses to open a directory at all, rather than opening it for fstat.
        if (code === 'EISDIR') {
            throw new Error(`${absolutePath} is not a file`, { cause: error });
        }
        if (code === undefined) {
            throw error;
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`cannot read ${absolutePath}: ${reason}`, { cause: error });
    } finally {
        if (descriptor !== undefined) {
            closeSync(descriptor);
        }
    }
}

/** Parameters for {@link createTemplateFileReader}. */
export interface CreateTemplateFileReaderParams {
    /** The template file, absolute or relative to the working directory. */
    templatePath: string;
}

/**
 * Build the `readFile` callback `extractAslFromTemplate` uses for a SAM `DefinitionUri` or
 * a CDK asset manifest and asset: it reads a path relative to the template's own directory,
 * not the working directory. Front ends hand it over on a `RenderDefinitionInput` for a
 * template that came from a file, and pass `null` for stdin, `serve` and inline text.
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
