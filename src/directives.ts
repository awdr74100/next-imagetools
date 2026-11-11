// Directive checks. imagetools-core ignores what it doesn't understand: a misspelled directive
// (`widht=300`), a value it can't parse (`w=abc`) or a typo in `as` all quietly produce the
// original image or the default output. These checks turn those into messages that say what
// went wrong and where.

/**
 * Directives imagetools-core v12 reads, plus the ones this package handles itself. Kept by hand
 * because core's own `parametersUsed` is always empty for the built-ins; drop it once core reports
 * usage (JonasKruckenberg/imagetools#966).
 */
export const KNOWN_DIRECTIVES = new Set([
  // resizing
  'w',
  'h',
  'aspect',
  'allowUpscale',
  'fit',
  'position',
  'kernel',
  // encoding
  'format',
  'quality',
  'lossless',
  'progressive',
  'effort',
  // operations
  'background',
  'blur',
  'brightness',
  'flatten',
  'flip',
  'flop',
  'grayscale',
  'hue',
  'invert',
  'median',
  'normalize',
  'noAutoOrient',
  'rotate',
  'saturation',
  'tint',
  // output
  'as',
  'basePixels',
  // `position` values that also work as bare directives (`?top`)
  'top',
  'right top',
  'right',
  'right bottom',
  'bottom',
  'left bottom',
  'left',
  'left top',
]);

/** Type-only markers (see client.d.ts), dropped before processing. */
export const TYPE_MARKERS = ['imagetools', 'imagetools-gallery'];

/** Outputs whose shape a marker picks: one value or an array, depending on the image count. */
const MARKED_OUTPUTS = new Set(['url', 'metadata', 'meta']);

/**
 * Checks the type marker that ends a query against what the import gives. The client types pick an
 * import's type by how its query ends, so a wrong marker makes TypeScript wrong about the value —
 * `string` for what is really an array — with nothing else to say so.
 */
export function checkMarker(query: string, as: string | null, count: number): string | undefined {
  const params = new URLSearchParams(query);
  const last = [...params.keys()].at(-1);
  if (last !== 'imagetools' && last !== 'imagetools-gallery') return undefined;
  const [output = 'url', keys] = (as ?? 'url').split(':');
  if (!MARKED_OUTPUTS.has(output)) {
    // from a preset or the defaults, the `as` isn't in the query for the client types to see
    return params.has('as')
      ? `as=${output} is typed without a marker; remove &${last}.`
      : `as=${output} comes from a preset or the defaults, so no marker can type this import; ` +
          `remove &${last} and declare its type, e.g. declare module '*preset=<name>'.`;
  }
  if (keys !== undefined) {
    return (
      `as=${output}:${keys} has no marker type, since its keys vary; remove &${last} and ` +
      `declare the import's type, or use as=${output} without keys.`
    );
  }
  // The client types see only how the query ends: `…&as=metadata&imagetools` types as metadata,
  // while the same marker after any other directive types as a URL — whatever the import gives.
  if (output !== 'url') {
    if (!params.has('as')) {
      return (
        `as=${output} comes from a preset or the defaults, so &${last} types this import as a ` +
        `URL; put as=${output} in the query, right before &${last}.`
      );
    }
    if ([...params.keys()].at(-2) !== 'as') {
      return (
        `&${last} types this import as metadata only when as=${output} comes right before it; ` +
        `here it types as a URL. Move as=${output} to the end: …&as=${output}&${last}.`
      );
    }
  }
  if (last === 'imagetools' && count > 1) {
    return (
      `the query gives ${count} images, an array, but &imagetools types it as a single value. ` +
      `End it with &imagetools-gallery.`
    );
  }
  if (last === 'imagetools-gallery' && count === 1) {
    return (
      'the query gives one image, a single value, but &imagetools-gallery types it as an ' +
      'array. End it with &imagetools.'
    );
  }
  return undefined;
}

/** Names people reach for that imagetools-core doesn't read, with what to use instead. */
const REPLACEMENTS: Record<string, string> = {
  width: 'w',
  height: 'h',
  withoutEnlargement: 'allowUpscale (images are never enlarged unless it is set)',
  withoutReduction: 'allowUpscale',
};

/**
 * Output formats there is an asset rule for. sharp encodes more (`jxl`, `jp2`, …), but an output
 * without a rule would leave its internal import unresolved, so those are rejected up front.
 */
export const OUTPUT_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heif'];

const positiveInteger = (v: string) => /^\d+$/.test(v) && Number(v) > 0;
const integer = (v: string) => /^-?\d+$/.test(v);
const number = (v: string) => v.trim() !== '' && Number.isFinite(Number(v));
const flagOrNumber = (v: string) => v === '' || v === 'true' || number(v);

/** Value checks for the directives imagetools-core would otherwise silently skip. */
const VALUE_RULES: Record<string, [check: (value: string) => boolean, expected: string]> = {
  format: [v => OUTPUT_FORMATS.includes(v), `one of ${OUTPUT_FORMATS.join(', ')}`],
  w: [positiveInteger, 'a positive integer'],
  h: [positiveInteger, 'a positive integer'],
  quality: [v => integer(v) && Number(v) >= 1 && Number(v) <= 100, 'an integer from 1 to 100'],
  rotate: [integer, 'an integer (degrees)'],
  hue: [integer, 'an integer (degrees)'],
  saturation: [number, 'a number'],
  brightness: [number, 'a number'],
  blur: [flagOrNumber, 'a number, or no value'],
  median: [flagOrNumber, 'a number, or no value'],
  effort: [v => integer(v) || v === 'min' || v === 'max', 'an integer, "min" or "max"'],
  aspect: [v => number(v) || /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(v), 'a number or a ratio like 16:9'],
};

export interface DirectiveProblems {
  /** Problems that make the import's result wrong; the build should fail. */
  errors: string[];
  /** Directives that have no effect. */
  warnings: string[];
}

/**
 * Checks resolved directives. `consumed` are keys the config file's `defaultDirectives` function
 * read: custom keys like `?hero` are legitimate when that function acts on them.
 */
export function checkDirectives(
  directives: URLSearchParams,
  outputFormats: Record<string, unknown>,
  consumed: ReadonlySet<string> = new Set(),
): DirectiveProblems {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [key, value] of directives) {
    if (KNOWN_DIRECTIVES.has(key) || key in outputFormats || consumed.has(key)) {
      const rule = VALUE_RULES[key];
      if (!rule) continue;
      const bad = value.split(';').filter(v => !rule[0](v));
      if (bad.length) {
        errors.push(`${key}=${bad.join(';')} is not valid: ${key} takes ${rule[1]}.`);
      }
      continue;
    }
    // misspellings of the replaced names (`widht`) should lead to the replacement too
    const near = closest(key, [...KNOWN_DIRECTIVES, ...Object.keys(REPLACEMENTS)]);
    const instead = REPLACEMENTS[key] ?? (near && (REPLACEMENTS[near] ?? near));
    warnings.push(
      `Unknown directive "${key}" has no effect.${instead ? ` Did you mean ${instead}?` : ''}`,
    );
  }

  const as = directives.get('as')?.split(':')[0];
  if (as !== undefined && !(as in outputFormats)) {
    const names = Object.keys(outputFormats);
    const suggestion = closest(as, names);
    errors.push(
      `Unknown output format as=${as}.${suggestion ? ` Did you mean as=${suggestion}?` : ''} ` +
        `Available: ${names.join(', ')}.`,
    );
  }

  return { errors, warnings };
}

/**
 * Drops empty values left by stray separators, so `format=webp;` means `format=webp` rather than a
 * second image with no format (and an array instead of a single value).
 */
export function dropEmptyValues(directives: URLSearchParams): void {
  // a snapshot: the loop rewrites entries of the object it would otherwise be iterating
  for (const [key, value] of Array.from(directives.entries())) {
    if (!value.includes(';')) continue;
    directives.set(key, value.split(';').filter(Boolean).join(';'));
  }
}

/** The candidate closest to `input` by edit distance, if any is close enough to be a typo. */
export function closest(input: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(input.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) [best, bestDistance] = [candidate, d];
  }
  return bestDistance <= Math.max(1, Math.floor(input.length / 3)) ? best : undefined;
}

/** Edit distance counting a swap of adjacent letters as one edit (`widht` → `width` is 1). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_row, i) =>
    Array.from({ length: b.length + 1 }, (_cell, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}
