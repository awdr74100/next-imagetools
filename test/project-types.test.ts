// The pieces of `turbopack-imagetools typegen` that don't need a Next.js app. The command itself,
// against the fixture, is in e2e/typegen-cli.test.ts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

import { withImagetools } from '../packages/turbopack-imagetools/src/index';
import {
  findImagetoolsOptions,
  findImports,
} from '../packages/turbopack-imagetools/src/project-types';

describe('findImagetoolsOptions', () => {
  it('reads the module loader options and the handled extensions back from the rules', () => {
    const config = withImagetools({}, { presets: { a: 'w=1' }, extensions: ['jpg', 'png'] });
    const found = findImagetoolsOptions(config.turbopack!.rules!);
    expect(found?.options).toMatchObject({ presets: { a: 'w=1' } });
    expect([...found!.extensions].toSorted()).toEqual(['jpg', 'png']);
  });

  it('finds nothing in a config without withImagetools', () => {
    expect(findImagetoolsOptions({ '*.svg': { loaders: ['@svgr/webpack'] } })).toBeUndefined();
  });
});

describe('findImports', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tpit-scan-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };

  it('finds static, dynamic and re-exported imports with a query in TS, TSX and JS', () => {
    write('a.ts', `import a from './a.jpg?w=1';\nimport plain from './plain.jpg';`);
    write('app/b.tsx', `export { default } from '../b.png?w=2';\nconst c = () => <img src="x" />;`);
    write('c.mjs', `const lazy = import('./c.webp?w=3');`);
    write('node_modules/pkg/d.ts', `import d from './d.jpg?w=4';`);
    write('types.d.ts', `declare module '*?w=5' {}\nimport e from './e.jpg?w=5';`);
    write('dist/f.ts', `import f from './f.jpg?w=6';`);

    const found = [...findImports(dir, ts, new Set([path.join(dir, 'dist')]))]
      .map(f => `${path.relative(dir, f.file).split(path.sep).join('/')} ${f.specifier}`)
      .toSorted();
    expect(found).toEqual(['a.ts ./a.jpg?w=1', 'app/b.tsx ../b.png?w=2', 'c.mjs ./c.webp?w=3']);
  });
});
