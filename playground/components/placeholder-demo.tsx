import Image from 'next/image';

import hero from '@/images/landscape.jpg?w=640;1280&format=webp&as=next';
import cropped from '@/images/portrait.jpg?w=240&h=240&fit=cover&format=webp&placeholder&as=img';
import color from '@/images/portrait.jpg?w=240&h=240&fit=cover&format=webp&placeholder=color&as=img';

// Placeholders are tiny, so they are shown scaled up with `pixelated` to see what they are.
const pixelated = { imageRendering: 'pixelated' } as const;

export function PlaceholderDemo() {
  return (
    <>
      <pre>{`import hero from '@/images/landscape.jpg?w=640;1280&format=webp&as=next';

<Image src={hero} placeholder="blur" sizes="928px" alt="" />`}</pre>
      <p>
        To watch the placeholder, throttle the network in DevTools (e.g. &ldquo;Slow 3G&rdquo;) and
        reload.
      </p>
      <Image src={hero} placeholder="blur" sizes="928px" alt="Hills at dusk" />

      <h3>What the placeholder is</h3>
      <p>
        <code>blurDataURL</code> is a {hero.blurWidth}×{hero.blurHeight} WebP inlined as a data URL
        — the same size Next.js uses for its own imports. next/image blurs it while the image loads.
      </p>
      <div className="row">
        <figure>
          <img
            src={hero.blurDataURL}
            width={hero.blurWidth * 20}
            height={hero.blurHeight * 20}
            style={pixelated}
            alt=""
          />
          <figcaption>
            {hero.blurWidth}×{hero.blurHeight}, scaled up
          </figcaption>
        </figure>
      </div>

      <h3>On any object output, from the cropped image</h3>
      <pre>{`import cropped from '@/images/portrait.jpg?w=240&h=240&fit=cover&format=webp&placeholder&as=img';
import color from '@/images/portrait.jpg?w=240&h=240&fit=cover&format=webp&placeholder=color&as=img';`}</pre>
      <div className="row">
        <figure>
          <img
            src={cropped.placeholder}
            width={cropped.w}
            height={cropped.h}
            style={pixelated}
            alt=""
          />
          <figcaption>placeholder: square, like the crop</figcaption>
        </figure>
        <figure>
          <img src={cropped.src} width={cropped.w} height={cropped.h} alt="" />
          <figcaption>the image</figcaption>
        </figure>
        <figure>
          <div
            style={{
              width: color.w,
              height: color.h,
              borderRadius: 8,
              background: color.placeholder,
            }}
          />
          <figcaption>placeholder=color: {color.placeholder}</figcaption>
        </figure>
      </div>
    </>
  );
}
