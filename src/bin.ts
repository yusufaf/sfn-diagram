#!/usr/bin/env node
import { reportUnexpectedError, run } from './cli';

void run(process.argv.slice(2))
    .then((code) => {
        // Set the exit code and let Node unwind on its own rather than calling
        // process.exit(). `--format html` embeds icons over fetch, and tearing the
        // process down while undici's sockets are still open aborts with a libuv
        // assertion (exit 9) on Windows. Unwinding naturally also avoids truncating
        // a large diagram when stdout is a pipe.
        process.exitCode = code;
    })
    .catch((error: unknown) => {
        // Without this handler an escaping exception surfaced as an unhandled
        // rejection: a raw stack trace, and an exit code chosen by Node rather than
        // by us. See reportUnexpectedError.
        process.exitCode = reportUnexpectedError(error);
    });
