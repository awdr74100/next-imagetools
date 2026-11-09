# Contributing to turbopack-imagetools

Thanks for your interest! Contributions of all kinds are welcome — bug reports, fixes, directives, docs and ideas.

This guide covers the **contribution process**. For the **technical deep-dive** — how the loaders work, the repo layout and the gotchas — read **[AGENTS.md](./AGENTS.md)**.

## Ways to contribute

- **Report a bug** — open an [issue](https://github.com/awdr74100/turbopack-imagetools/issues) with a reproduction. Say whether it still happens after deleting `.next` and `node_modules/.cache/turbopack-imagetools`; caching bugs are the most common kind here.
- **Request a feature** — describe the problem you're trying to solve, not just the solution.
- **Send a pull request** — for anything non-trivial, please open an issue first so we can agree on the approach before you invest time.

## Prerequisites

- **Node.js 24 LTS or newer** (see [`.node-version`](./.node-version)).
- **pnpm 11** — pinned via `packageManager` in the root `package.json`, so [Corepack](https://nodejs.org/api/corepack.html) uses it automatically.

## Getting started

```bash
git clone https://github.com/awdr74100/turbopack-imagetools.git
cd turbopack-imagetools
pnpm install
pnpm exec playwright install chromium
pnpm build
pnpm test
```

## Development workflow

The canonical checks — the same gates CI enforces on every push and PR — run from the repo root:

```bash
pnpm check && pnpm build && pnpm test
```

- **Tests run against the built package.** The fixture app in `fixtures/next-app` consumes `packages/turbopack-imagetools/dist`, the way users do, so run `pnpm build` after changing the package. The suites refuse to run without a build.
- **Test the cache states, not just the happy path.** A change to the loaders should hold up cold, warm, with only `.next` or only the imagetools cache cleared, after the source image is edited, and across a `next dev` restart. `test/build.test.ts` and `test/dev.test.ts` walk through those states; extend them rather than adding a one-off check.
- **No git hooks.** Formatting and lint are enforced by CI, so run `pnpm format` before committing.
- **English only** in code, comments, docs and fixture copy (`pnpm lint:english`).

## Commit & PR conventions

- **[Conventional Commits](https://www.conventionalcommits.org/)** — `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `ci:`, etc. The version bump and changelog are derived from these.
- **PR titles are validated** (`semantic-pr.yml`). PRs are **squash-merged**, so the PR title becomes the commit on `main` — write it carefully.

## Releasing

Releases are cut by the maintainer with `pnpm release` (`scripts/release.mjs`): it suggests the bump from the commits, writes `CHANGELOG.md`, commits and tags locally, and asks before pushing. The pushed tag runs `.github/workflows/release.yml`, which builds, tests, publishes to npm with provenance (OIDC trusted publishing, no token) and creates the GitHub Release.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](./LICENSE).
