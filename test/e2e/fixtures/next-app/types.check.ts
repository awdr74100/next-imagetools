// Type tests for turbopack-imagetools/client, run by `tsc --noEmit` (pnpm typecheck).
// Each import must infer the shape the loader really returns; the @ts-expect-error lines fail the
// typecheck if a pattern ever starts inferring something looser.
import url from './images/hero.jpg?w=400&format=webp&imagetools';
import gallery from './images/hero.jpg?w=300;600&format=webp&imagetools-gallery';
import img from './images/hero.jpg?w=300;600&as=img';
import metaGallery from './images/hero.jpg?w=300;600&as=metadata&imagetools-gallery';
import meta, { hasAlpha, src, width } from './images/hero.jpg?w=500&as=metadata&imagetools';
import { sources } from './images/hero.jpg?w=400&format=avif;webp&as=picture';
import picture from './images/hero.jpg?w=400;800&format=avif;webp&as=picture';
import srcset from './images/hero.jpg?w=300;600&as=srcset';

url satisfies string;
gallery satisfies string[];
srcset satisfies string;
img satisfies { src: string; w: number; h: number; srcset?: string };
picture satisfies { sources: Record<string, string>; img: { src: string; w: number; h: number } };
meta satisfies { src: string; width: number; height: number; format: string };
meta.channels satisfies number | undefined; // sharp metadata comes through
metaGallery satisfies { src: string }[];
src satisfies string;
width satisfies number;
hasAlpha satisfies boolean | undefined;
sources satisfies Record<string, string>;

// @ts-expect-error a single URL is not an array
url satisfies string[];
// @ts-expect-error a gallery is not a single URL
gallery satisfies string;
// @ts-expect-error single metadata is not an array
meta satisfies unknown[];
// @ts-expect-error a gallery of metadata is not one object
metaGallery.src satisfies string;
