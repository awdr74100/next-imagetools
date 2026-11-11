// Pins the workspace to the oldest Next.js the package supports — the lower bound of its `next`
// peer range — so CI can run the suites against it. The package's own dev copy, the e2e fixture
// and the playground all take `next` from the pnpm catalog, so one line covers them: they have to
// match, or TypeScript sees two different NextConfig types.
import { readFileSync, writeFileSync } from 'node:fs';

const peer = JSON.parse(readFileSync('package.json', 'utf8')).peerDependencies.next;
const min = /^>=\s*(\d+\.\d+\.\d+)$/.exec(peer)?.[1];
if (!min) throw new Error(`Expected a ">=x.y.z" next peer range, got "${peer}".`);

const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
const pinned = workspace.replace(/^(catalog:\n(?: {2}.*\n)*? {2}next: ).*$/m, `$1${min}`);
if (pinned === workspace) throw new Error('No `next` entry in the pnpm-workspace.yaml catalog.');
writeFileSync('pnpm-workspace.yaml', pinned);
console.log(`next pinned to ${min} in the pnpm catalog`);
