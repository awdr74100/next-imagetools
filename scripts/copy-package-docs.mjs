// npm shows the README and LICENSE from the published package directory, but the canonical
// copies live at the repo root. Runs as the package's `prepack`, so `pnpm pack` / `npm publish`
// always ship the current root versions; the copies are git-ignored.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'packages', 'turbopack-imagetools');
for (const file of ['README.md', 'LICENSE']) copyFileSync(join(root, file), join(pkg, file));
