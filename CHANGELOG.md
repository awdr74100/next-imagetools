# Changelog


## v0.2.0

[compare changes](https://github.com/awdr74100/next-imagetools/compare/v0.1.0...v0.2.0)

### 🚀 Enhancements

- Support Next.js with webpack (next build --webpack) ([#29](https://github.com/awdr74100/next-imagetools/pull/29))

### 🩹 Fixes

- Check that as=metadata comes right before the type marker ([#33](https://github.com/awdr74100/next-imagetools/pull/33))
- Match upper-case extensions under webpack, as Next.js does ([#34](https://github.com/awdr74100/next-imagetools/pull/34))

### 📖 Documentation

- Add an npm version badge to the README ([#28](https://github.com/awdr74100/next-imagetools/pull/28))
- Explain background images in CSS, and that url() queries aren't processed ([#31](https://github.com/awdr74100/next-imagetools/pull/31))
- Cover webpack where the docs assumed Turbopack, and align the package description ([#37](https://github.com/awdr74100/next-imagetools/pull/37))

### 🏡 Chore

- Leave CHANGELOG.md out of formatting ([#27](https://github.com/awdr74100/next-imagetools/pull/27))
- Stop publishing source maps ([#32](https://github.com/awdr74100/next-imagetools/pull/32))
- Add VS Code settings for oxfmt, oxlint and the workspace TypeScript ([#38](https://github.com/awdr74100/next-imagetools/pull/38))

### ✅ Tests

- Cover @/ alias imports, and use them in the playground ([#30](https://github.com/awdr74100/next-imagetools/pull/30))
- Wait for hydration before clicking in the mode suite ([#35](https://github.com/awdr74100/next-imagetools/pull/35))

### 🤖 CI

- Install Chromium without apt in the release workflow, and ask for the bundler in bug reports ([#36](https://github.com/awdr74100/next-imagetools/pull/36))

### ❤️ Contributors

- Roya ([@awdr74100](https://github.com/awdr74100))

## v0.1.0


### 🚀 Enhancements

- Build-time image transforms for Next.js with Turbopack ([40500bf](https://github.com/awdr74100/next-imagetools/commit/40500bf))
- Export the keys of object results by name ([#6](https://github.com/awdr74100/next-imagetools/pull/6))
- Keep the source's file name for same-format outputs ([#7](https://github.com/awdr74100/next-imagetools/pull/7))
- Add presets and defaultDirectives ([#8](https://github.com/awdr74100/next-imagetools/pull/8))
- Add include and exclude options ([#9](https://github.com/awdr74100/next-imagetools/pull/9))
- Replace cacheDir with cache { dir, enabled, retention } ([#10](https://github.com/awdr74100/next-imagetools/pull/10))
- Add the inline directive ([#11](https://github.com/awdr74100/next-imagetools/pull/11))
- Support options that take functions through a config file ([#12](https://github.com/awdr74100/next-imagetools/pull/12))
- Report directive mistakes instead of silently ignoring them ([#15](https://github.com/awdr74100/next-imagetools/pull/15))
- Add as=next and the placeholder directive ([#17](https://github.com/awdr74100/next-imagetools/pull/17))
- Generate exact types for App Router imports with types: true ([#18](https://github.com/awdr74100/next-imagetools/pull/18))

### 🩹 Fixes

- Keep the return shape independent of the source size ([#3](https://github.com/awdr74100/next-imagetools/pull/3))
- Encode generated URLs, keep animations, and test deployment shapes ([#16](https://github.com/awdr74100/next-imagetools/pull/16))
- Clamp EXIF-rotated photos upright and treat multi-page TIFFs as stills ([#21](https://github.com/awdr74100/next-imagetools/pull/21))
- Start changelogen from the release script on Windows ([#25](https://github.com/awdr74100/next-imagetools/pull/25))

### 💅 Refactors

- Replace generated types with checked type markers ([#22](https://github.com/awdr74100/next-imagetools/pull/22))

### 📖 Documentation

- Rewrite the README and ship it with the package ([#1](https://github.com/awdr74100/next-imagetools/pull/1))
- Add AGENTS.md and a CLAUDE.md that imports it ([#13](https://github.com/awdr74100/next-imagetools/pull/13))
- Say plainly that Turbopack is the default and webpack builds aren't supported yet ([#26](https://github.com/awdr74100/next-imagetools/pull/26))

### 🏡 Chore

- Move the test app to test/fixtures and add a playground ([#2](https://github.com/awdr74100/next-imagetools/pull/2))
- Move to Node.js 26 LTS and pnpm 12, and upgrade vitest, oxlint and oxfmt ([#20](https://github.com/awdr74100/next-imagetools/pull/20))
- Rename to next-imagetools and move the package to the repo root ([#24](https://github.com/awdr74100/next-imagetools/pull/24))

### ✅ Tests

- Wait for servers to release their port, and log them on failure ([#5](https://github.com/awdr74100/next-imagetools/pull/5))
- Split the suites into unit and e2e projects ([#14](https://github.com/awdr74100/next-imagetools/pull/14))

### 🤖 CI

- Build before typecheck, fix semantic-pr action version comment ([dca5573](https://github.com/awdr74100/next-imagetools/commit/dca5573))
- Test against the oldest supported Next.js ([#19](https://github.com/awdr74100/next-imagetools/pull/19))

### ❤️ Contributors

- Roya ([@awdr74100](https://github.com/awdr74100))

