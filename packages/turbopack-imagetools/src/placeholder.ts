// Placeholders shown while the real image loads. Built from the processed image, not the source,
// so a cropped variant gets a placeholder with the same aspect ratio and no layout shift.
import type { OutputFormat, ProcessedImage } from 'imagetools-core';
import type { Sharp } from 'sharp';

// The values Next.js uses for the `blurDataURL` of static imports (next-image-loader/blur.js),
// so `placeholder="blur"` looks the same as for a plain import.
const BLUR_SIZE = 8;
const BLUR_QUALITY = 70;

export interface Blur {
  dataURL: string;
  width: number;
  height: number;
}

/** A tiny WebP data URL, `BLUR_SIZE` pixels on its longer side; next/image blurs it with CSS. */
export async function blurOf(image: Sharp, width: number, height: number): Promise<Blur> {
  const [w, h] =
    width >= height
      ? [BLUR_SIZE, Math.max(Math.round((height / width) * BLUR_SIZE), 1)]
      : [Math.max(Math.round((width / height) * BLUR_SIZE), 1), BLUR_SIZE];
  const data = await image
    .clone()
    .resize(w, h, { fit: 'fill' })
    .webp({ quality: BLUR_QUALITY })
    .toBuffer();
  return { dataURL: `data:image/webp;base64,${data.toString('base64')}`, width: w, height: h };
}

/** The image's dominant color as `#rrggbb`. */
export async function colorOf(image: Sharp): Promise<string> {
  const { dominant } = await image.clone().stats();
  return `#${[dominant.r, dominant.g, dominant.b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The variant a single-value result describes: the widest, as imagetools-core's `img` picks. */
export const largest = (images: ProcessedImage[]): ProcessedImage =>
  images.reduce((a, b) => (b.info.width > a.info.width ? b : a));

/**
 * `as=next`: the shape of a Next.js static image import (`StaticImageData`), so the result goes
 * straight into `<Image src={…} placeholder="blur" />`.
 */
export const nextFormat: OutputFormat = () => async images => {
  const image = largest(images);
  const { width, height } = image.info;
  const blur = await blurOf(image.image, width, height);
  return {
    src: image.src,
    width,
    height,
    blurDataURL: blur.dataURL,
    blurWidth: blur.width,
    blurHeight: blur.height,
  };
};

export type PlaceholderKind = 'blur' | 'color';

/** Parses the `placeholder` directive: bare or `blur` for a blurred image, `color` for a color. */
export function placeholderKind(value: string): PlaceholderKind {
  if (value === '' || value === 'blur') return 'blur';
  if (value === 'color') return 'color';
  throw new Error(
    `placeholder=${value} is not valid: placeholder takes no value, "blur" or "color".`,
  );
}

export async function placeholderOf(kind: PlaceholderKind, image: ProcessedImage): Promise<string> {
  return kind === 'color'
    ? colorOf(image.image)
    : (await blurOf(image.image, image.info.width, image.info.height)).dataURL;
}
