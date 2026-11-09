# turbopack-imagetools

Build-time image transforms for Next.js with Turbopack, powered by [imagetools-core](https://github.com/JonasKruckenberg/imagetools).

```tsx
import hero from './hero.jpg?w=400;800;1200&format=avif;webp&as=picture';
```

The import is the whole API: the transforms are written where the image is used, every variant is generated at build time, and what you get back are plain static files under `/_next/static/media`. No image optimization server, no `/_next/image` route, no runtime cost.

> **Status: pre-release.** The loader works across every rendering mode listed below and is tested against them on Linux and Windows, but the API may still change before 1.0.

## Why

`next/image` optimizes on demand, at request time ([vercel/next.js#19065](https://github.com/vercel/next.js/discussions/19065), open since 2020). That needs a running server, and with `output: 'export'` it isn't available at all.

Crawling rendered pages to find out which images to generate doesn't solve it either: images that only appear after a click, inside a client-only component or behind auth are never rendered at build time, so they 404 in production ([nuxt/image#2379](https://github.com/nuxt/image/issues/2379) shows the same failure in Nuxt).

Generating from **imports** sidesteps both problems. If the code imports it, it is built, whatever renders it and whenever.

## Install

```bash
pnpm add turbopack-imagetools
```

Requires Next.js 16.2 or newer with Turbopack (the default bundler), and Node.js 22.12 or newer.

```ts
// next.config.ts
import type { NextConfig } from 'next';
import { withImagetools } from 'turbopack-imagetools';

const nextConfig: NextConfig = {
  // ...
};

export default withImagetools(nextConfig);
```

Imports **without** a query are left alone, so `import logo from './logo.png'` keeps behaving exactly as Next.js defines it.

### TypeScript

Add the client types to any `.d.ts` in your app (for example `imagetools.d.ts`):

```ts
/// <reference types="turbopack-imagetools/client" />
```

TypeScript allows a single `*` in a module declaration, so an import is typed by how its query ends:

```ts
import url from './hero.jpg?w=800&format=webp&imagetools'; // string
import urls from './hero.jpg?w=400;800&format=webp&imagetools-gallery'; // string[]
import meta from './hero.jpg?w=800&format=webp&as=metadata&imagetools'; // ImagetoolsMetadata
import srcset from './hero.jpg?w=400;800&format=webp&as=srcset'; // string
import img from './hero.jpg?w=400;800&as=img'; // Img
import picture from './hero.jpg?w=400;800&format=avif;webp&as=picture'; // Picture
```

The `&imagetools` and `&imagetools-gallery` markers only pick the type. They are dropped before processing, so marked and unmarked imports of the same image share their output. They are the same markers vite-imagetools users already write, so those imports carry over unchanged.

## Usage

Directives are the ones from imagetools-core. See [the directive reference](https://github.com/JonasKruckenberg/imagetools/blob/main/docs/directives.md) for the full list (`w`, `h`, `format`, `quality`, `fit`, `position`, `blur`, `rotate`, `flip`, `tint`, …). Separate values with `;` to generate one image per value. Multiple directives with several values produce every combination.

```tsx
import Image from 'next/image';

import hero from './hero.jpg?w=1200&format=webp&as=metadata&imagetools';
import picture from './hero.jpg?w=480;960;1440&format=avif;webp;jpg&as=picture';

export function Hero() {
  return <Image src={hero.src} width={hero.width} height={hero.height} alt="" unoptimized />;
}

export function Responsive() {
  return (
    <picture>
      {Object.entries(picture.sources).map(([format, srcset]) => (
        <source key={format} type={`image/${format}`} srcSet={srcset} />
      ))}
      <img src={picture.img.src} width={picture.img.w} height={picture.img.h} alt="" />
    </picture>
  );
}
```

Widths and heights larger than the source are clamped to the source size unless you add `allowUpscale=true`.

### Static export

With `output: 'export'`, Next.js refuses to build while its image optimizer is enabled, even though nothing needs it here. Turn it off:

```ts
export default withImagetools({
  output: 'export',
  images: { unoptimized: true },
});
```

### Options

```ts
withImagetools(nextConfig, {
  // where processed images are cached between builds
  cacheDir: 'node_modules/.cache/turbopack-imagetools',
  // strip EXIF, ICC and other private metadata from the output (default: true)
  removeMetadata: true,
  // source extensions handled when imported with a query
  extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif'],
});
```

Options are passed to Turbopack loaders, which only accept JSON-serializable values.

## Tested

Every change runs the same fixture app through:

- `next build` + `next start`: a statically prerendered route, a dynamic SSR route, an Edge runtime route, a client-only route (`next/dynamic` with `ssr: false`), and the Pages Router (static and `getServerSideProps`)
- `output: 'export'` served by a plain static file server, with no Next.js at runtime
- `next dev`, including editing the source image while it runs and restarting it with the persistent cache in place
- cold builds, warm builds, and builds with only `.next` or only the imagetools cache removed

Each image is fetched, decoded and checked for format, dimensions and pixel content. The routes are also loaded in Chromium, which must decode every `<img>`, including one that renders only after a click.

## How it works

Turbopack runs webpack-style loaders, but its loader API has no `emitFile`, and files written during a build are invisible to its resolver. So the loader never emits files itself:

1. An import such as `./hero.jpg?w=400;800&format=webp` is matched by a rule on its query and runs the module loader. The loader resolves the directives with imagetools-core, processes each variant with sharp (caching the result on disk), and returns a small JavaScript module.
2. That module imports each variant back from the **source file**, with an internal query that identifies the variant (`./hero.jpg?tpit=…&tpit_ext=webp&w=400&format=webp`).
3. A second rule matches the internal query and marks the import as an `asset`. Its loader returns the encoded bytes, and Turbopack's own asset pipeline hashes and emits the file and exports its URL.

The emitted files are ordinary Turbopack assets, which is why every rendering mode works the same way.

## Acknowledgements

The directive syntax, transforms and output formats come from [imagetools](https://github.com/JonasKruckenberg/imagetools) by Jonas Kruckenberg. This package only bridges them to Turbopack.

## License

[MIT](./LICENSE)
