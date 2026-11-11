# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub private vulnerability reporting](https://github.com/awdr74100/turbopack-imagetools/security/advisories/new): go to the [Security tab](https://github.com/awdr74100/turbopack-imagetools/security) and click **Report a vulnerability**. The report stays private between you and the maintainer until a fix is released.

What to expect:

- **Acknowledgement within 3 days.** The project is maintained by one person, so please allow a little slack across time zones and weekends.
- An assessment of impact and affected versions, and a fix timeline proportional to severity.
- **Coordinated disclosure.** Please keep the report private until a fix is released. We will agree on a publication date with you and aim to publish an advisory within 90 days of triage, sooner for severe issues.
- Credit in the published advisory and release notes, unless you prefer to stay anonymous.

## Supported versions

Only the **latest release** receives security fixes.

## Security model

turbopack-imagetools runs **only at build time and in `next dev`**, inside the Next.js process on your machine or CI runner. Nothing of it ships to the browser except the image files it generates and the small modules that reference them.

- **Inputs.** Image files your source imports, and the directives in the import's query string. Both come from your own repository; the loader never fetches anything over the network.
- **Decoding.** Images are decoded and encoded by [sharp](https://sharp.pixelplumbing.com/) (libvips). Treat images from untrusted sources the way you would any file handed to an image decoder.
- **File writes.** Only inside the cache directory (`node_modules/.cache/turbopack-imagetools` by default, or the `cache.dir` you configure), and with `types: true`, inside `<distDir>/types/turbopack-imagetools` — by the loader, the post-compile hook and the `turbopack-imagetools typegen` command. Emitted images go through Turbopack's own asset pipeline into `.next` / `out`.

## Scope

**In scope:** anything that lets an import or an image make the loader read or write outside the paths above, or produce output that differs from what the directives ask for in a security-relevant way.

**Out of scope — please report these where they belong:**

- **Image decoder vulnerabilities** in libvips or sharp — report to [sharp](https://github.com/lovell/sharp/security) / [libvips](https://github.com/libvips/libvips/security); open a regular issue here if a patched release needs a bump.
- **Other dependencies** — report upstream; open a regular issue here if a bump is needed.
- **Next.js / Turbopack themselves** — report to [Vercel](https://vercel.com/security).
