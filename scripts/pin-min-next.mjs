// Pins every workspace package to the oldest Next.js the package supports — the lower bound of
// its `next` peer range — so CI can run the suites against it. All of them at once: the package's
// own dev copy has to match the apps', or TypeScript sees two different NextConfig types.
import { readFileSync, writeFileSync } from 'node:fs';

const PACKAGES = [
  'packages/turbopack-imagetools/package.json',
  'test/e2e/fixtures/next-app/package.json',
  'playground/package.json',
];

const peer = JSON.parse(readFileSync(PACKAGES[0], 'utf8')).peerDependencies.next;
const min = /^>=\s*(\d+\.\d+\.\d+)$/.exec(peer)?.[1];
if (!min) throw new Error(`Expected a ">=x.y.z" next peer range, got "${peer}".`);

for (const file of PACKAGES) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  for (const field of ['dependencies', 'devDependencies']) {
    if (pkg[field]?.next) pkg[field].next = min;
  }
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
console.log(`next pinned to ${min} in ${PACKAGES.length} packages`);
