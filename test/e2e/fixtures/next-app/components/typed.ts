// Imports without type markers: their types come from the generated declarations alone — the
// CLI's before a build (pnpm typecheck), the loader's during one (next build's type check).
import metas from '../images/hero.jpg?w=200;400&format=webp&as=metadata';
import pair from '../images/hero.jpg?w=200;400&format=webp';
import single from '../images/hero.jpg?w=200&format=webp';

single satisfies string;
pair satisfies string[];
metas satisfies { width: number; height: number }[];

// @ts-expect-error one image is a single URL
single satisfies string[];
// @ts-expect-error two images are an array
pair satisfies string;

export const typed = { single, pair, metas };
