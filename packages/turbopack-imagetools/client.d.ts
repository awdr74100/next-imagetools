// Ambient types for imagetools imports. Reference them from a .d.ts in your app:
//
//   /// <reference types="turbopack-imagetools/client" />
//
// TypeScript allows a single `*` per module pattern, so an import is typed by how its query ends.
// End the query on a marker to pick the shape; the markers are stripped before processing, so a
// marked and an unmarked import of the same image share one output file:
//
//   import hero from './hero.jpg?w=800&format=webp&imagetools';             // string
//   import thumbs from './hero.jpg?w=200;400&format=webp&imagetools-gallery'; // string[]
//   import meta from './hero.jpg?w=800&as=metadata&imagetools';             // ImagetoolsMetadata
//
// The markers match vite-imagetools' documented ones, so imports carry over unchanged.
// `as=srcset`, `as=img` and `as=picture` always produce a single value, so those also type
// without a marker as long as the `as=` directive comes last.

/** Flat metadata of one generated image: sharp's metadata, with the output's size and format. */
interface ImagetoolsMetadata extends Omit<import('sharp').Metadata, 'width' | 'height' | 'format'> {
  /** URL of the generated image. */
  src: string;
  width: number;
  height: number;
  format: string;
}

declare module '*&as=metadata&imagetools' {
  const metadata: ImagetoolsMetadata;
  export default metadata;
}

declare module '*&as=metadata&imagetools-gallery' {
  const metadata: ImagetoolsMetadata[];
  export default metadata;
}

declare module '*&as=meta&imagetools' {
  const metadata: ImagetoolsMetadata;
  export default metadata;
}

declare module '*&as=meta&imagetools-gallery' {
  const metadata: ImagetoolsMetadata[];
  export default metadata;
}

declare module '*&imagetools' {
  const url: string;
  export default url;
}

declare module '*&imagetools-gallery' {
  const urls: string[];
  export default urls;
}

declare module '*as=srcset' {
  const srcset: string;
  export default srcset;
}

declare module '*as=img' {
  const img: import('imagetools-core').Img;
  export default img;
}

declare module '*as=picture' {
  const picture: import('imagetools-core').Picture;
  export default picture;
}
