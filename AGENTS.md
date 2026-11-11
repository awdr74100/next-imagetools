# AGENTS.md

Guidance for anyone — human or agent — working in this repository. Read it before changing code.

## What this is

`next-imagetools` brings [imagetools-core](https://github.com/JonasKruckenberg/imagetools) directives to Next.js with Turbopack: `import hero from './hero.jpg?w=400;800&format=webp&as=srcset'` generates every variant at build time as plain static assets. It also supports webpack (`next build --webpack`). User-facing behavior is documented in [README.md](./README.md); this file covers how it works and how to work on it.

## Layout

- The repo root is the published package (`package.json`, `src`, `client.d.ts`); the playground and the e2e fixture are pnpm workspace members that depend on it.
  - `src/index.ts` — `withImagetools()`, which adds the Turbopack rules and the webpack rule to `next.config`. Runs when the config loads, so it must not import anything heavy at runtime (`shared.ts` pulls in sharp).
  - `src/loader.ts` — the **module loader**: resolves directives, processes variants, returns a JS module. Under webpack it also emits the images.
  - `src/asset-loader.ts` — the **asset loader** (Turbopack only): returns the encoded bytes of one variant.
  - `src/directives.ts` — directive checks: known names, value rules, typo suggestions.
  - `src/shared.ts` — processing, the disk cache, cache keys, config-file loading. Bundled into one chunk shared by both loaders, so its in-process memo is shared too.
  - `src/config.ts` / `src/core.ts` — the `next-imagetools/config` and `/core` entries for config files.
  - `client.d.ts` — ambient module types (`next-imagetools/client`).
- `playground` — a Next.js app for trying things by hand (`pnpm playground`).
- `test` — the unit suites (`*.test.ts`), which call the built loaders and `withImagetools()` directly.
- `test/e2e` — the end-to-end suites. `test/e2e/fixtures/next-app` is the app they build, start and inspect; the suites rewrite its source image and switch its routes between modes, so don't treat it as a demo.
- `scripts` — release, English-only check, pinning the oldest supported Next.js for CI.

## How it works

Turbopack runs webpack-style loaders, but its loader API has **no `emitFile`**, and **files written during a build are invisible to its resolver** (a cold build fails to resolve them; the second build passes — don't be fooled). So the loaders never write output files:

1. An import with a query matches the module rule and runs `loader.ts`. It resolves directives (defaults → config-file defaults → preset → query), clamps sizes to the source, expands them with imagetools-core, processes each variant through `processImage` (disk-cached), and runs the output format.
2. The returned module imports each variant **back from the source file** with an internal query: `./hero.jpg?nit=<source hash>&nit_ext=webp&<config>`.
3. A per-format asset rule matches `nit_ext=<ext>`, sets `type: 'asset'`, and runs `asset-loader.ts`, which returns the bytes. Turbopack's own asset pipeline hashes and emits the file and gives the module its URL.

Placeholders (`__NIT_<i>__`) stand in for URLs while the output format runs, and are spliced out of the JSON into references to the imported assets.

Under webpack, `withImagetools()` extends the config's `webpack()` function with one rule, whose options carry a `webpack` target (compiler type, dev, `assetPrefix`, hash salt). Webpack has `emitFile`, so there is no round trip: the module loader emits each variant where Next.js' `next-image-loader` emits static images for that compiler, and puts the URL straight into the module.

## Gotchas

- **Under webpack, the work happens in `pitch`.** Next.js' image rule matches the same imports, and webpack applies every matching rule. Ours is `enforce: 'post'`, so its loader pitches first, and a pitch that returns a module skips every other loader — and the reading of the resource, which is why `pitch` calls `addDependency` on the source. Turbopack never sets `webpack` in the options, so the pitch returns nothing there.
- **Next.js' metadata images use queries too** (`?__next_metadata__`, …); the webpack rule's `resourceQuery` leaves anything with `__next_` to Next.js.

- **Turbopack's `as` must contain `*`, and `*` is the whole file name.** `as: '*.webp'` turns `hero.jpg` into `hero.jpg.webp` — also in the asset loader's `resourcePath`, which is why it strips the extra extension. Same-format outputs skip the rename.
- **Loader options are JSON.** Functions can't cross into the worker processes; that's why `configFile` exists. Option types must be assignable to Next's `JSONValue`: use `type` aliases, not `interface`s, for nested option objects.
- **Two different roots.** Turbopack rule `path` conditions are relative to Turbopack's root, which in a monorepo is the workspace root. The loaders' `rootContext` is the Next.js app. Anything a user writes as a path (`include`, `exclude`, `configFile`, `cache.dir`) is resolved against `rootContext`.
- **Loaders are CommonJS** with `default`, `raw` (and, for the module loader, `pitch`) named exports, which is what loader-runner reads. Keep the dynamic `import()` of the config file native (it is, in tsdown's CJS output) — a `require()` couldn't load ESM or take the `?v=` query.
- **Return shape follows the query only.** Values clamped to the same size are kept, not merged; single-value formats (`srcset`, `img`, `picture`) dedupe before formatting. Don't reintroduce the merge.
- **Cache keys** cover the config, the source hash, `removeMetadata`, the package and `sharp.versions` (every codec), and the config file's hash. Anything new that changes the encoded bytes must go into the key.
- **Every cache layer matters:** the bundler's (inputs → `addDependency`, under Turbopack and webpack alike), Node's module cache (config imported by content hash), and the disk cache (keys). A change touching any of them needs a test for edits across all three.

- **imagetools-core ignores what it doesn't understand.** Unknown directives and unparsable values silently fall back to defaults (and `parametersUsed` from `generateTransforms` is empty for the built-ins, so it can't detect them). `directives.ts` keeps the known names and value rules; `test/directives.test.ts` checks the list against core's source, so an upgrade that renames a directive fails there.
- **Type markers are checked, not trusted.** `checkMarker` in `directives.ts` fails the build when the marker that ends a query disagrees with the image count, or sits on an output that types without one. The client types can't see the count; the loader can.
- **Warnings go through `warn()`,** errors through `withContext()` (both in `shared.ts`): they prefix the import (`images/hero.jpg?w=…`), and `warn()` drops the stack trace Turbopack would otherwise print under the message.

- **Client types: pattern precedence.** TypeScript picks, among matching module patterns, the one with the longest prefix before `*`, and on a tie the one declared first. Every pattern in `client.d.ts` starts with `*`, so order decides: `*as=metadata&imagetools` must stay above `*&imagetools`, or metadata imports type as `string`. Metadata patterns don't start with `&`, since `as` can come right after the `?`. The fixture's `components/typed.ts` type-checks both.

## Commands

All from the repo root. pnpm is pinned via `packageManager`.

```bash
pnpm install
pnpm build                 # the package, with tsdown (+ publint)
pnpm check                 # typecheck, oxlint, English-only check, oxfmt --check, knip
pnpm test                  # every suite; needs `pnpm build` first
pnpm playground            # build + next dev in playground/
```

`pnpm test:unit` runs the unit project (seconds, no Next.js); `pnpm test:e2e` the e2e project (`build`, `deploy`, `dev`, `modes`, `playground`), which drives real Next.js builds, servers and Chromium — minutes, and a fair amount of memory. Run one file with `pnpm vitest run <path>`.

## Testing

- **Unit or e2e?** Anything observable from the loader's output or `withImagetools()`'s config is a unit test; the unit suite makes its own source image in a temp dir and never touches the fixture. Whatever depends on the bundler itself — resolution, emitting, caching, rendering modes, `next dev` — needs e2e.
- **Tests run against `dist`.** Both projects load the built package, the way users do. Rebuild after changing the package; the suites refuse to run without a build.
- **Test the cache states, not just the happy path.** `test/e2e/build.test.ts` and `test/e2e/dev.test.ts` walk through cold, warm, partially cleared and edited states in order; extend them rather than adding one-off checks.
- **The oldest supported Next.js and Node.js.** The `next` peer range starts at 16.2, the release that added the rule `type` and `condition.query` the package depends on; `engines` starts at Node.js 22.12. CI's `test-min` job pins the whole workspace to that Next.js (`scripts/pin-min-next.mjs`), builds on the current Node.js (the build tools need it), and runs every suite on that Node.js, so raising either floor means changing the range, nothing else. Don't match generated file names with a fixed hash alphabet: 16.2 also uses `~`.
- **Both bundlers.** Every e2e suite runs once per entry of `BUNDLERS` in `test/e2e/helpers.ts`: `build()` and `startServer('dev', …)` take a `bundler` and pass `--webpack`. `next start` serves whatever was built. `NIT_BUNDLER=webpack` (or `turbopack`) runs one only; CI runs each bundler as its own job.
- **Every rendering mode.** `test/e2e/modes.test.ts` checks static, SSR, Edge, CSR, the Pages Router and static export in Chromium. A new import shape belongs in the fixture's `ImageGrid` and `expectedImages`, so every mode checks it.
- **Prove a test can fail.** For a fix, break the code back (or patch `dist`) and watch the new test fail before trusting it.
- **README examples are code.** `test/loader.test.ts` runs the config-file example from the README verbatim; keep it that way when editing examples.
- Failing build, dev and mode tests print the Next.js server log. See issue #4 for an intermittent dev failure still being investigated.

## Conventions

- **English only** in code, comments, docs, tests and fixture copy (`pnpm lint:english`).
- **Conventional Commits** for commits and PR titles (validated by `semantic-pr.yml`). PRs are squash-merged; the PR title becomes the commit on `main`.
- **No AI attribution** in commits or PRs: no `Co-Authored-By` trailers, no mentions of AI tools.
- Match the surrounding code: comment _why_, not what; formatting is oxfmt's.
- Keep docs truthful: only document what is implemented and tested.
- oxfmt sorts imports inside Markdown code blocks too, so a comment on its own line after an import can end up under a different one. In README examples, put the comment on the import's line, or each import in its own block.

## Releasing

`pnpm release` (`scripts/release.mjs`) suggests a version from the commits — keeping pre-1.0 bumps sensible, which changelogen alone doesn't — writes `CHANGELOG.md`, commits and tags locally, and asks before pushing. The pushed tag runs `.github/workflows/release.yml`: build, test, `npm publish` via OIDC trusted publishing (provenance included), then the GitHub Release from the changelog.
