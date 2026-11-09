# turbopack-imagetools

[![CI](https://github.com/awdr74100/turbopack-imagetools/actions/workflows/ci.yml/badge.svg)](https://github.com/awdr74100/turbopack-imagetools/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Build-time image transforms for Next.js with Turbopack. Describe the variants you want in the import, and get static, optimized files — no image server, no runtime cost, and it works with `output: 'export'`.

```tsx
import hero from './hero.jpg?w=480;960;1440&format=avif;webp&as=picture';

export function Hero() {
  return (
    <picture>
      {Object.entries(hero.sources).map(([format, srcset]) => (
        <source key={format} type={`image/${format}`} srcSet={srcset} />
      ))}
      <img src={hero.img.src} width={hero.img.w} height={hero.img.h} alt="" />
    </picture>
  );
}
```

Powered by [imagetools-core](https://github.com/JonasKruckenberg/imagetools), the engine behind vite-imagetools, so the directive syntax is the same.

> [!NOTE]
> **Pre-release.** Everything documented here is implemented and tested, but the API may still change before 1.0.

- [Why](#why)
- [Installation](#installation)
- [Usage](#usage)
- [TypeScript](#typescript)
- [Recipes](#recipes)
- [Configuration](#configuration)
- [Migrating from vite-imagetools](#migrating-from-vite-imagetools)
- [How it works](#how-it-works)
- [Troubleshooting](#troubleshooting)

## Why

`next/image` optimizes images **on demand**, when they are first requested. That needs a running Next.js server, and with `output: 'export'` it is not available at all — a limitation discussed since 2020 in [vercel/next.js#19065](https://github.com/vercel/next.js/discussions/19065).

Pre-generating images by crawling the rendered pages has its own blind spot: an image that only appears after a click, inside a client-only component, or behind a login is never rendered at build time, so it 404s in production. [nuxt/image#2379](https://github.com/nuxt/image/issues/2379) documents exactly this failure.

turbopack-imagetools generates images from **imports** instead. If your code imports an image, every variant it asks for is built — however and whenever it ends up rendered.

- **Explicit.** The transforms live in the import that uses them, not in a config file somewhere else.
- **Static.** Output is plain files under `/_next/static/media`, cached by your CDN like any other asset.
- **Every rendering mode.** Static, SSR, Edge, client components, the Pages Router and static export all behave the same.
- **Fast rebuilds.** Processed images are cached on disk, keyed by the source content and the directives.

## Installation

```bash
pnpm add turbopack-imagetools
# or: npm install turbopack-imagetools / yarn add turbopack-imagetools
```

**Requirements:** Next.js 16.2 or newer with Turbopack (the default bundler), and Node.js 22.12 or newer.

Wrap your Next.js config with `withImagetools`:

```ts
// next.config.ts
import type { NextConfig } from 'next';
import { withImagetools } from 'turbopack-imagetools';

const nextConfig: NextConfig = {
  // your existing config
};

export default withImagetools(nextConfig);
```

Wrapping the config is how Next.js plugins hook in (`@next/mdx`, `@next/bundle-analyzer` and others work the same way). `withImagetools` only adds rules to `turbopack.rules`; the rest of your config is passed through untouched, and rules you already have for image files keep running first.

Then [set up the types](#typescript) if you use TypeScript.

## Usage

Add a query to an image import. The query is a list of **directives**:

```ts
import thumbnail from './photo.jpg?w=300&format=webp';
```

Imports **without** a query are not touched, so `import logo from './logo.png'` still behaves exactly as Next.js defines it.

### Directives

The most common ones:

- `w` / `h` — width / height in pixels
- `format` — `avif`, `webp`, `jpg`, `png`, `gif`, `tiff` or `heif`
- `quality` — `1`–`100`
- `fit` — `cover`, `contain`, `fill`, `inside` or `outside` (when both `w` and `h` are set)
- `position` — where to crop from with `fit=cover`, e.g. `top` or `attention`
- `blur`, `rotate`, `flip`, `flop`, `grayscale`, `tint`, `normalize`, `lossless`, `progressive`, …

See the [imagetools directive reference](https://github.com/JonasKruckenberg/imagetools/blob/main/docs/directives.md) for every directive and its values. (It still lists `withoutEnlargement` and `withoutReduction`, which imagetools-core no longer reads; sizes are never enlarged unless you add `allowUpscale`.)

Mistakes are reported instead of silently producing the wrong image. Each message names the import it is about:

- an **unknown directive** logs a warning with the closest match — `widht=300` → _Did you mean w?_
- an **invalid value** fails the build — `w=abc`, `quality=0`, or a `format` without output support such as `jxl`
- an **unknown output format** fails the build — `as=piture` → _Did you mean as=picture?_

A stray separator is ignored: `format=webp;` means `format=webp`, not a second image without a format.

Widths and heights larger than the source are reduced to the source size, so a 1600px photo never comes out at 3000px. Add `allowUpscale=true` to scale up anyway. When that makes two variants identical — `w=1600;3000` on a 1600px photo — both are kept (they share one file) and the build logs a warning, so the [shape of the import](#multiple-variants) doesn't change with the source.

Add `inline` to embed the image in your JavaScript as a `data:` URL instead of emitting a file — worth it for tiny images such as blurred placeholders, where a separate request costs more than the bytes:

```ts
import placeholder from './photo.jpg?w=24&blur=2&format=webp&inline';
// "data:image/webp;base64,…"
```

### Multiple variants

Separate values with `;` to get one image per value. With several directives, you get every combination:

```ts
// 3 widths × 2 formats = 6 images
import urls from './photo.jpg?w=400;800;1200&format=avif;webp';
```

The number of images is always the product of the value counts in the query, so you can tell from the query alone whether an import gives one value or an array. It never depends on the source file: swapping in a smaller photo can't turn an array into a string.

### Output formats

`as` chooses what the import gives you back.

**Default — URL.** One image gives a URL string; several give an array of URLs.

```ts
import url from './photo.jpg?w=800&format=webp'; // "/_next/static/media/…webp"
import urls from './photo.jpg?w=400;800&format=webp'; // ["…", "…"]
```

**`as=srcset`** — a ready-made `srcset` string.

```tsx
import srcset from './photo.jpg?w=400;800;1200&format=webp&as=srcset';

<img srcSet={srcset} sizes="(min-width: 768px) 50vw, 100vw" alt="" />;
```

**`as=img`** — `{ src, w, h }` for the largest image, plus `srcset` when there are several.

```tsx
import photo from './photo.jpg?w=400;800&format=webp&as=img';

<img src={photo.src} srcSet={photo.srcset} width={photo.w} height={photo.h} alt="" />;
```

**`as=picture`** — `{ sources, img }`: a `srcset` per format, and a fallback `<img>` built from the **last** format. List the format you want as fallback last.

```ts
import photo from './photo.jpg?w=400;800&format=avif;webp;jpg&as=picture';
// photo.sources → { avif: "…", webp: "…" }, photo.img → { src, w, h } (jpg)
```

**`as=metadata`** (or `as=meta`) — the image's metadata: `src`, `width`, `height`, `format`, and everything else [sharp reports](https://sharp.pixelplumbing.com/api-input#metadata) (`channels`, `hasAlpha`, `space`, …). An array when there are several images. Narrow it to specific keys with `as=metadata:width;height`.

```ts
import photo from './photo.jpg?w=800&format=webp&as=metadata';
// { src: "…", width: 800, height: 533, format: "webp", … }
```

**Named imports.** When the result is a single object (`as=metadata`, `as=img`, `as=picture`), its keys are also exported by name:

```ts
import { src, width, height } from './photo.jpg?w=800&format=webp&as=metadata';
import { sources, img } from './photo.jpg?w=400;800&format=avif;webp&as=picture';
```

## TypeScript

Reference the client types once, from any `.d.ts` file in your app:

```ts
// imagetools.d.ts
/// <reference types="turbopack-imagetools/client" />
```

TypeScript matches module declarations by pattern and allows only one `*`, so the type is picked by **how the query ends**:

```ts
import srcset from './photo.jpg?w=400;800&format=webp&as=srcset'; // string
import img from './photo.jpg?w=400;800&as=img'; // Img
import picture from './photo.jpg?w=400;800&format=avif;webp&as=picture'; // Picture
```

For the URL and metadata outputs, whether you get one value or an array depends on how many images the query asks for — more than one value anywhere means an array — so end the query with a marker that says which:

```ts
import url from './photo.jpg?w=800&format=webp&imagetools'; // string
import urls from './photo.jpg?w=400;800&format=webp&imagetools-gallery'; // string[]
import meta from './photo.jpg?w=800&as=metadata&imagetools'; // ImagetoolsMetadata
import metas from './photo.jpg?w=400;800&as=metadata&imagetools-gallery'; // ImagetoolsMetadata[]
```

The markers only select the type and are removed before processing, so a marked and an unmarked import of the same image share their output files. They are the same markers commonly used with vite-imagetools.

## Recipes

### With `next/image`

The generated files are already optimized, so tell `next/image` not to optimize them again with `unoptimized` (otherwise Next.js re-encodes them through `/_next/image` at request time):

```tsx
import Image from 'next/image';

import photo from './photo.jpg?w=1200&format=webp&as=metadata&imagetools';

<Image src={photo.src} width={photo.width} height={photo.height} alt="" unoptimized />;
```

### Static export

With `output: 'export'`, Next.js refuses to build while its image optimizer is enabled — even though nothing needs it. Turn it off:

```ts
export default withImagetools({
  output: 'export',
  images: { unoptimized: true },
});
```

The exported site needs no Next.js server; any static host or CDN serves the images.

### Images that render only on the client

Nothing special is needed. Images are generated because they are imported, not because they were rendered during the build, so this works in `next dev`, `next build` and static export alike:

```tsx
'use client';
import { useState } from 'react';

import zoomed from './photo.jpg?w=2000&format=webp&imagetools';

export function Zoom() {
  const [open, setOpen] = useState(false);
  return open ? <img src={zoomed} alt="" /> : <button onClick={() => setOpen(true)}>Zoom</button>;
}
```

## Configuration

Pass options as the second argument:

```ts
export default withImagetools(nextConfig, {
  cache: { dir: 'node_modules/.cache/turbopack-imagetools', retention: 60 * 60 * 24 * 30 },
  removeMetadata: true,
  namedExports: true,
  extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif'],
});
```

- **`cache`** — the on-disk cache of processed images:
  - `dir` — where, relative to your Next.js app. Default: `node_modules/.cache/turbopack-imagetools`. Persist it in CI to speed up builds.
  - `retention` — remove entries that haven't been used for this many seconds. Default: keep everything.
  - `enabled` — set to `false` to process every image on every build. Default: `true`.
- **`removeMetadata`** — strip EXIF, ICC, XMP and other private metadata from generated images. Default: `true`.
- **`namedExports`** — also export the keys of object results by name, as in `import { width } from './a.jpg?as=metadata'`. Default: `true`.
- **`extensions`** — source file extensions handled when imported with a query. Default: `jpg`, `jpeg`, `png`, `webp`, `avif`, `gif`, `tiff`, `heif`.
- **`include`** — globs; only imports whose path matches one of them are handled. Default: all.
- **`exclude`** — globs; imports whose path matches one of them are never handled.

`include` and `exclude` match paths relative to your Next.js app (where `next.config.ts` is), also in a monorepo — `exclude: ['src/legacy/**']`. An import they rule out is left to Next.js exactly as if it had no query.

Options must be JSON-serializable: Turbopack runs loaders in separate worker processes and passes their options as data.

### Presets and defaults

Give a set of directives a name, and use it with `preset=<name>`:

```ts
export default withImagetools(nextConfig, {
  presets: {
    hero: 'w=640;1280;1920&format=avif;webp&as=picture',
    thumb: { w: '160', h: '160', fit: 'cover', format: 'webp' },
  },
  defaultDirectives: 'quality=80',
});
```

```ts
import hero from './banner.jpg?preset=hero';
import avatar from './me.jpg?preset=thumb&imagetools';
```

- **`presets`** — named directive sets, as a query string or an object. An unknown preset name fails the build.
- **`defaultDirectives`** — applied to every import that has a query (imports without one are left to Next.js).

The directives of an import are layered: `defaultDirectives` first, then the preset, then the import's own query — so `?preset=thumb&w=200` uses the preset with a different width. The import still shows which preset it uses, so its transforms stay traceable from the code.

Prefer single values in `defaultDirectives` (`quality`, `effort`, a single `format`). A list such as `format=avif;webp` multiplies the images of _every_ import, turning single values into arrays; the build warns when the config loads.

### Custom transforms and output formats

Turbopack passes loader options to worker processes as JSON, so options that take functions live in a module of their own. Point `configFile` at it (relative to your Next.js app):

```ts
// next.config.ts
export default withImagetools(nextConfig, { configFile: './imagetools.config.mjs' });
```

```js
// imagetools.config.mjs
import { defineConfig } from 'turbopack-imagetools/config';

export default defineConfig({
  // add an output format: import sizes from './a.jpg?w=400;800&as=sizes'
  extendOutputFormats: builtins => ({
    ...builtins,
    sizes: () => images => images.map(image => ({ src: image.src, width: image.info.width })),
  }),

  // add a transform, applied when its directive is present: ./a.jpg?w=400&sepia
  extendTransforms: builtins => [
    ...builtins,
    config =>
      'sepia' in config
        ? (_, image) =>
            image.recomb([
              [0.393, 0.769, 0.189],
              [0.349, 0.686, 0.168],
              [0.272, 0.534, 0.131],
            ])
        : undefined,
  ],

  // directives that depend on the image itself
  defaultDirectives: async (url, metadata) =>
    new URLSearchParams((await metadata()).hasAlpha ? 'format=webp' : 'format=avif'),
});
```

- **`extendOutputFormats`** — receives the built-in output formats, returns the ones to use. A format's result is serialized into the importing module, so it must be JSON-serializable.
- **`extendTransforms`** — receives the built-in transform factories, returns the ones to use.
- **`resolveConfigs`** — replaces how directives expand into the list of images to generate.
- **`defaultDirectives`** — directives computed per image; `metadata()` reads the source's [sharp metadata](https://sharp.pixelplumbing.com/api-input#metadata). They sit between the `defaultDirectives` option and the preset.

Editing the config file takes effect immediately, also in a running `next dev`: it is tracked as a dependency of every import that uses it, and its content is part of every cache key. The imagetools-core API it builds on is re-exported from `turbopack-imagetools/core`. A `.ts` config file needs a Node.js version that runs TypeScript natively (22.18 or newer); otherwise use `.mjs` or `.js`.

Types for a custom output format are up to you, as with any `as=` value TypeScript can't know about:

```ts
// imagetools.d.ts
declare module '*as=sizes' {
  const sizes: { src: string; width: number }[];
  export default sizes;
}
```

## Migrating from vite-imagetools

Directives, output formats and the `&imagetools` type markers are the same, so most imports move over unchanged. Replace the Vite plugin with `withImagetools` in `next.config.ts`, and swap your hand-written module declarations for the [client types](#typescript).

One deliberate difference: when values clamp to the source size and become identical, vite-imagetools merges them, so `w=1600;3000` on a 1600px source gives a single URL instead of an array. Here the array keeps both entries, so the shape of an import [follows from its query](#multiple-variants).

`defaultDirectives` takes directives as data (a query string or an object) rather than a function. For per-image presets, use [`presets`](#presets-and-defaults) — `?preset=hero` instead of a custom `?hero` directive.

Options that take functions (`extendTransforms`, `extendOutputFormats`, `resolveConfigs`, and `defaultDirectives` as a function) move to a [config file](#custom-transforms-and-output-formats).

## How it works

Turbopack runs webpack-style loaders, but its loader API has no `emitFile`, and files written during a build are invisible to its resolver. So the loader never writes output files itself:

1. An import with a query, like `./photo.jpg?w=400;800&format=webp`, runs the **module loader**. It resolves the directives with imagetools-core, processes each variant with sharp (caching the result on disk), and returns a small JavaScript module.
2. That module imports each variant back from the **source file**, with an internal query that identifies it.
3. A second rule matches that internal query and marks the import as an **asset**. Its loader returns the encoded image, and Turbopack's own asset pipeline hashes the file, emits it, and gives the module its URL.

Because the generated images are ordinary Turbopack assets, they behave the same in every rendering mode and deployment target.

Generated files are named after their source: `hero.<hash>.jpg` when the format stays the same, and `hero.jpg.<hash>.webp` when it changes. Turbopack can only rename a module by adding to its file name, so a converted image keeps its original extension in the name.

## Troubleshooting

**An image looks outdated, or a change doesn't show up.** Delete `.next` and `node_modules/.cache/turbopack-imagetools` and rebuild. If that fixes it, please [open an issue](https://github.com/awdr74100/turbopack-imagetools/issues/new/choose) — caches are supposed to invalidate on their own.

**`Cannot find module './photo.jpg?…'` in TypeScript.** The client types aren't loaded, or the query doesn't end the way a declaration expects. See [TypeScript](#typescript).

**`Warning: AVIF image not supported` during the build.** Turbopack logs this for generated AVIF files. The files are emitted correctly; the warning comes from Turbopack's own image handling and can be ignored.

## Contributing

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development setup and the test suites.

## Acknowledgements

The directive syntax, transforms and output formats come from [imagetools](https://github.com/JonasKruckenberg/imagetools) by Jonas Kruckenberg. This package bridges them to Turbopack.

## License

[MIT](./LICENSE) © Roya
