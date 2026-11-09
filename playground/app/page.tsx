import Image from 'next/image';

import { Zoom } from '../components/zoom';
import badgeAvif from '../images/badge.png?w=200&format=avif&imagetools';
import badgeWebp from '../images/badge.png?w=200&format=webp&imagetools';
import sizes from '../images/landscape.jpg?w=1200&format=avif;webp;jpg&as=metadata&imagetools-gallery';
import hero from '../images/landscape.jpg?w=1200&format=webp&as=metadata&imagetools';
import picture from '../images/landscape.jpg?w=480;960;1440&format=avif;webp;jpg&as=picture';
import srcset from '../images/landscape.jpg?w=480;960;1440&format=webp&as=srcset';
import blurred from '../images/portrait.jpg?w=200&blur=12&format=webp&imagetools';
import cropBottom from '../images/portrait.jpg?w=200&h=200&fit=cover&position=bottom&format=webp&imagetools';
import cropAttention from '../images/portrait.jpg?w=200&h=200&fit=cover&position=attention&format=webp&imagetools';
import cropTop from '../images/portrait.jpg?w=200&h=200&fit=cover&position=top&format=webp&imagetools';
import gray from '../images/portrait.jpg?w=200&grayscale&format=webp&imagetools';
import rotated from '../images/portrait.jpg?w=200&rotate=90&format=webp&imagetools';

const kb = (bytes: number | undefined) => `${((bytes ?? 0) / 1024).toFixed(1)} kB`;

export default function Page() {
  return (
    <main>
      <h1>turbopack-imagetools</h1>
      <p className="lead">
        Every image on this page was generated at build time from an import. Open DevTools → Network
        to see the static files under <code>/_next/static/media</code>.
      </p>

      <section>
        <h2>Responsive srcset</h2>
        <p>Three widths; the browser picks one based on the viewport and screen density.</p>
        <pre>{`import srcset from './landscape.jpg?w=480;960;1440&format=webp&as=srcset';`}</pre>
        <img srcSet={srcset} sizes="(min-width: 960px) 928px, 100vw" alt="Hills at dusk" />
      </section>

      <section>
        <h2>&lt;picture&gt; with modern formats</h2>
        <p>AVIF where supported, then WebP, with a JPEG fallback (the last format listed).</p>
        <pre>{`import picture from './landscape.jpg?w=480;960;1440&format=avif;webp;jpg&as=picture';`}</pre>
        <picture>
          {Object.entries(picture.sources).map(([format, set]) => (
            <source key={format} type={`image/${format}`} srcSet={set} sizes="928px" />
          ))}
          <img
            src={picture.img.src}
            width={picture.img.w}
            height={picture.img.h}
            alt="Hills at dusk"
          />
        </picture>
      </section>

      <section>
        <h2>File size by format</h2>
        <p>The same 1200px image in each format, from the metadata output.</p>
        <pre>{`import sizes from './landscape.jpg?w=1200&format=avif;webp;jpg&as=metadata&imagetools-gallery';`}</pre>
        <ul className="sizes">
          {sizes.map(image => (
            <li key={image.format}>
              {image.format}: {kb(image.size)} ({image.width}×{image.height})
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>With next/image</h2>
        <p>
          Metadata gives <code>next/image</code> the dimensions it needs. The file is already
          optimized, so <code>unoptimized</code> stops Next.js from re-encoding it.
        </p>
        <pre>{`import hero from './landscape.jpg?w=1200&format=webp&as=metadata&imagetools';

<Image src={hero.src} width={hero.width} height={hero.height} alt="" unoptimized />`}</pre>
        <Image
          src={hero.src}
          width={hero.width}
          height={hero.height}
          alt="Hills at dusk"
          unoptimized
        />
      </section>

      <section>
        <h2>Cropping</h2>
        <p>
          <code>fit=cover</code> fills the box; <code>position</code> picks which part to keep.
        </p>
        <pre>{`import cropTop from './portrait.jpg?w=200&h=200&fit=cover&position=top&format=webp';`}</pre>
        <div className="row">
          <figure>
            <img src={cropTop} width={200} height={200} alt="" />
            <figcaption>position=top</figcaption>
          </figure>
          <figure>
            <img src={cropAttention} width={200} height={200} alt="" />
            <figcaption>position=attention</figcaption>
          </figure>
          <figure>
            <img src={cropBottom} width={200} height={200} alt="" />
            <figcaption>position=bottom</figcaption>
          </figure>
        </div>
      </section>

      <section>
        <h2>Transparency</h2>
        <p>The PNG&apos;s alpha channel survives conversion to WebP and AVIF.</p>
        <pre>{`import badge from './badge.png?w=200&format=avif';`}</pre>
        <div className="row">
          <figure>
            <div className="checkerboard">
              <img src={badgeWebp} width={200} height={200} alt="" />
            </div>
            <figcaption>webp</figcaption>
          </figure>
          <figure>
            <div className="checkerboard">
              <img src={badgeAvif} width={200} height={200} alt="" />
            </div>
            <figcaption>avif</figcaption>
          </figure>
        </div>
      </section>

      <section>
        <h2>Effects</h2>
        <p>Any imagetools directive, applied at build time.</p>
        <pre>{`import gray from './portrait.jpg?w=200&grayscale&format=webp';`}</pre>
        <div className="row">
          <figure>
            <img src={gray} width={200} alt="" />
            <figcaption>grayscale</figcaption>
          </figure>
          <figure>
            <img src={blurred} width={200} alt="" />
            <figcaption>blur=12</figcaption>
          </figure>
          <figure>
            <img src={rotated} width={200} alt="" />
            <figcaption>rotate=90</figcaption>
          </figure>
        </div>
      </section>

      <section>
        <h2>Rendered only after a click</h2>
        <p>
          Generated because it is imported, not because it was rendered — so it exists even though
          the build never shows it.
        </p>
        <Zoom />
      </section>
    </main>
  );
}
