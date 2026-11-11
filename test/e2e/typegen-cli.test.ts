// `turbopack-imagetools typegen`, run as users run it: the built command, on the fixture app.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { clean } from './helpers';

const APP = path.resolve(import.meta.dirname, 'fixtures/next-app');
const CLI = path.join(APP, 'node_modules/turbopack-imagetools/dist/cli.mjs');
const TYPES = path.join(APP, '.next/types/turbopack-imagetools');
const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: APP, encoding: 'utf8' });

describe('turbopack-imagetools typegen', { concurrent: false }, () => {
  it('writes a declaration per image query in the app, and the app type-checks with them', () => {
    clean({ next: true });
    // the order `pnpm typecheck` uses: Next.js' route types first, then ours, then tsc
    const nextTypegen = spawnSync(
      process.execPath,
      [path.join(APP, 'node_modules/next/dist/bin/next'), 'typegen'],
      { cwd: APP, encoding: 'utf8', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } },
    );
    expect(nextTypegen.status, nextTypegen.stderr).toBe(0);
    const result = run('typegen');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(
      /^turbopack-imagetools: types for \d+ import queries in \.next\/types\/turbopack-imagetools/,
    );
    const files = readdirSync(TYPES);
    expect(files.length).toBeGreaterThan(10);
    expect(files.every(f => /^[0-9a-f]{16}\.d\.ts$/.test(f))).toBe(true);

    // components/typed.ts imports without type markers, so it only checks with these types
    const tsc = spawnSync(
      process.execPath,
      [path.join(APP, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'],
      { cwd: APP, encoding: 'utf8' },
    );
    expect(tsc.status, tsc.stdout + tsc.stderr).toBe(0);
  });

  it('skips imports that exclude rules out, as the loader does', () => {
    // images/raw/** is excluded in the fixture's next.config, and only imported with ?w=10
    const content = readdirSync(TYPES)
      .map(f => readFileSync(path.join(TYPES, f), 'utf8'))
      .join('\n');
    expect(content).not.toContain('?w=10&format=webp&imagetools"');
  });

  it('removes declarations no import needs any more', () => {
    const stale = path.join(TYPES, '0000000000000000.d.ts');
    writeFileSync(stale, '// stale');
    const result = run('typegen');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/1 outdated removed/);
    expect(existsSync(stale)).toBe(false);
  });

  it('fails clearly for an app without withImagetools', () => {
    const dir = path.join(APP, '.next', 'not-an-app');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), '{}');
    writeFileSync(path.join(dir, 'next.config.mjs'), 'export default {};');
    try {
      const result = spawnSync(process.execPath, [CLI, 'typegen', dir], {
        cwd: APP,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/doesn't use withImagetools|needs (typescript|next)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails clearly when generated types are off, their default', () => {
    // resolves next and turbopack-imagetools from the fixture above it
    const dir = path.join(APP, '.next', 'types-off');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), '{}');
    writeFileSync(
      path.join(dir, 'next.config.mjs'),
      "import { withImagetools } from 'turbopack-imagetools';\nexport default withImagetools({});",
    );
    try {
      const result = spawnSync(process.execPath, [CLI, 'typegen', dir], {
        cwd: APP,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Generated types are off: pass `types: true`/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
