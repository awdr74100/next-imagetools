<!--
Thank you for contributing!

Before opening the PR, please make sure the PR title follows Conventional Commits
(`feat: …`, `fix: …`, `docs: …`). It is validated by CI, and with squash merges it becomes
the commit on `main` and drives the changelog — write it carefully.
-->

## Description

<!--
What is this PR solving, and why? Link the issues it resolves, e.g. `Fixes #123`.
-->

## Checklist

- [ ] The canonical checks pass locally: `pnpm build && pnpm check && pnpm test`
- [ ] Tests are added or updated for any behavior change — including the cache states it can meet (cold, warm, one cache cleared, source edited) when it touches caching
- [ ] Documentation is updated if needed
