#!/usr/bin/env node
// `turbopack-imagetools typegen [dir]`: writes the declarations the loader writes during a build,
// before there is one — for a CI that type-checks first. See project-types.ts.
import path from 'node:path';
import process from 'node:process';

import { typegen } from './project-types';

async function main(argv: string[]): Promise<void> {
  const [command, dirArg] = argv;
  if (command !== 'typegen') {
    console.log('Usage: turbopack-imagetools typegen [dir]');
    process.exitCode = command === undefined || command === '--help' ? 0 : 1;
    return;
  }
  const dir = path.resolve(dirArg ?? '.');
  const { written, removed, typesDir } = await typegen(dir);
  console.log(
    `turbopack-imagetools: types for ${written} import ${written === 1 ? 'query' : 'queries'} in ` +
      `${path.relative(dir, typesDir).split(path.sep).join('/') || '.'}` +
      (removed ? `, ${removed} outdated removed` : ''),
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
