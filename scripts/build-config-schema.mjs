// Writes config.schema.json, the JSON Schema for sfn-diagram.config.*, from the same
// field table the CLI validates against (src/cliConfig.ts CONFIG_FIELDS). The file is
// committed: it ships in the npm package for a version-pinned `$schema` path, and the
// docs site serves it at https://sfn.yusufaf.dev/config.schema.json.
// tests/config/cliConfigSchema.test.ts fails when the committed file is stale.
//
// Run with tsx, which loads the TypeScript source directly:
//   pnpm run build:config-schema

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCliConfigSchema } from '../src/cliConfigSchema.ts';

const outputPath = fileURLToPath(new URL('../config.schema.json', import.meta.url));
writeFileSync(outputPath, `${JSON.stringify(buildCliConfigSchema(), null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
