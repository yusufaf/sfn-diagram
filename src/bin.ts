#!/usr/bin/env node
import { run } from './cli';

void run(process.argv.slice(2)).then((code) => {
    // Set the exit code and let Node unwind on its own rather than calling
    // process.exit(). `--format html` embeds icons over fetch, and tearing the
    // process down while undici's sockets are still open aborts with a libuv
    // assertion (exit 9) on Windows. Unwinding naturally also avoids truncating
    // a large diagram when stdout is a pipe.
    process.exitCode = code;
});
