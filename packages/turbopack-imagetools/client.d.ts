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
// The markers match the ones commonly used with vite-imagetools, so imports carry over unchanged.
// Object results (metadata, img, picture) are also exported by name:
//
//   import { src, width, height } from './hero.jpg?w=800&as=metadata&imagetools';
//
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
  export const src: ImagetoolsMetadata['src'];
  export const width: ImagetoolsMetadata['width'];
  export const height: ImagetoolsMetadata['height'];
  export const format: ImagetoolsMetadata['format'];
  export const size: ImagetoolsMetadata['size'];
  export const space: ImagetoolsMetadata['space'];
  export const channels: ImagetoolsMetadata['channels'];
  export const depth: ImagetoolsMetadata['depth'];
  export const density: ImagetoolsMetadata['density'];
  export const isProgressive: ImagetoolsMetadata['isProgressive'];
  export const hasProfile: ImagetoolsMetadata['hasProfile'];
  export const hasAlpha: ImagetoolsMetadata['hasAlpha'];
  export const orientation: ImagetoolsMetadata['orientation'];
}

declare module '*&as=metadata&imagetools-gallery' {
  const metadata: ImagetoolsMetadata[];
  export default metadata;
}

declare module '*&as=meta&imagetools' {
  const metadata: ImagetoolsMetadata;
  export default metadata;
  export const src: ImagetoolsMetadata['src'];
  export const width: ImagetoolsMetadata['width'];
  export const height: ImagetoolsMetadata['height'];
  export const format: ImagetoolsMetadata['format'];
  export const size: ImagetoolsMetadata['size'];
  export const space: ImagetoolsMetadata['space'];
  export const channels: ImagetoolsMetadata['channels'];
  export const depth: ImagetoolsMetadata['depth'];
  export const density: ImagetoolsMetadata['density'];
  export const isProgressive: ImagetoolsMetadata['isProgressive'];
  export const hasProfile: ImagetoolsMetadata['hasProfile'];
  export const hasAlpha: ImagetoolsMetadata['hasAlpha'];
  export const orientation: ImagetoolsMetadata['orientation'];
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
  export const src: import('imagetools-core').Img['src'];
  export const w: import('imagetools-core').Img['w'];
  export const h: import('imagetools-core').Img['h'];
  export const srcset: import('imagetools-core').Img['srcset'];
}

declare module '*as=picture' {
  const picture: import('imagetools-core').Picture;
  export default picture;
  export const sources: import('imagetools-core').Picture['sources'];
  export const img: import('imagetools-core').Picture['img'];
}
