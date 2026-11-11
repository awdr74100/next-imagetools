// Imports typed by the client types' markers, type-checked by `pnpm typecheck` and by next build;
// the build checks each marker against what the import gives. ImageGrid renders the values, and the
// suites check them at runtime.
import metas from '../images/hero.jpg?w=200;400&format=webp&as=metadata&imagetools-gallery';
import pair from '../images/hero.jpg?w=200;400&format=webp&imagetools-gallery';
import single from '../images/hero.jpg?w=200&format=webp&imagetools';
import meta from '../images/hero.jpg?as=metadata&imagetools';

single satisfies string;
pair satisfies string[];
metas satisfies { width: number; height: number }[];
// `as` first, right after the `?`
meta satisfies { width: number; height: number };

// @ts-expect-error one image is a single URL
single satisfies string[];
// @ts-expect-error two images are an array
pair satisfies string;

export const typed = { single, pair, metas, meta };
