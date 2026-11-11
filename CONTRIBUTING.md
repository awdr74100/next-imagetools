# Contributing to turbopack-imagetools

Thanks for your interest! Contributions of all kinds are welcome — bug reports, fixes, directives, docs and ideas.

This guide covers the **contribution process**. For the **technical deep-dive** — how the loaders work, the repo layout and the gotchas — read **[AGENTS.md](./AGENTS.md)**.

## Ways to contribute

- **Report a bug** — open an [issue](https://github.com/awdr74100/turbopack-imagetools/issues) with a reproduction. Say whether it still happens after deleting `.next` and `node_modules/.cache/turbopack-imagetools`; caching bugs are the most common kind here.
- **Request a feature** — describe the problem you're trying to solve, not just the solution.
- **Send a pull request** — for anything non-trivial, please open an issue first so we can agree on the approach before you invest time.

## Prerequisites

- **Node.js 26 LTS** (see [`.node-version`](./.node-version)). The package itself supports Node.js 22.12 or newer, which CI checks; developing it needs a current release.
- **pnpm 12** — install it with `npm install -g pnpm@12` or [another method](https://pnpm.io/installation) (Node.js no longer bundles Corepack). The exact version is pinned via `packageManager` in the root `package.json`, and pnpm switches to it on its own.

## Getting started

```bash
git clone https://github.com/awdr74100/turbopack-imagetools.git
cd turbopack-imagetools
pnpm install
pnpm exec playwright install chromium
pnpm build
pnpm test
```

To try a change by hand, run the playground — a small Next.js app that shows every output format:

```bash
pnpm playground
```

It builds the package and starts `next dev` in `playground/`. Rebuild the package (`pnpm build`) and restart the playground after changing the loaders.

## Repository layout

- `packages/turbopack-imagetools` — the published package
- `playground` — a Next.js app for trying things by hand
- `test` — unit tests, which call the built loaders directly (seconds)
- `test/e2e` — end-to-end tests with real Next.js builds, servers and Chromium (minutes); `test/e2e/fixtures/next-app` is the app they build, start and inspect. It is not meant for browsing: the suites rewrite its source image and switch its routes between modes.

## Development workflow

The canonical checks — the same gates CI enforces on every push and PR — run from the repo root:

```bash
pnpm check && pnpm build && pnpm test
```

While iterating, `pnpm test:unit` runs only the unit tests and finishes in seconds; `pnpm test:e2e` runs only the end-to-end tests.

- **Tests run against the built package.** Both suites, and the fixture app in `test/e2e/fixtures/next-app`, consume `packages/turbopack-imagetools/dist`, the way users do, so run `pnpm build` after changing the package. The suites refuse to run without a build.
- **Test the cache states, not just the happy path.** A change to the loaders should hold up cold, warm, with only `.next` or only the imagetools cache cleared, after the source image is edited, and across a `next dev` restart. `test/e2e/build.test.ts` and `test/e2e/dev.test.ts` walk through those states; extend them rather than adding a one-off check.
- **No git hooks.** Formatting and lint are enforced by CI, so run `pnpm format` before committing.
- **English only** in code, comments, docs and fixture copy (`pnpm lint:english`).

## Commit & PR conventions

- **[Conventional Commits](https://www.conventionalcommits.org/)** — `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `ci:`, etc. The version bump and changelog are derived from these.
- **PR titles are validated** (`semantic-pr.yml`). PRs are **squash-merged**, so the PR title becomes the commit on `main` — write it carefully.

## Releasing

Releases are cut by the maintainer with `pnpm release` (`scripts/release.mjs`): it suggests the bump from the commits, writes `CHANGELOG.md`, commits and tags locally, and asks before pushing. The pushed tag runs `.github/workflows/release.yml`, which builds, tests, publishes to npm with provenance (OIDC trusted publishing, no token) and creates the GitHub Release.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](./LICENSE).
