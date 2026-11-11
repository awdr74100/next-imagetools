import Image from 'next/image';

// file names that need URL encoding: a space would split a srcset entry in two
import accented from '../images/café.jpg?w=40&format=webp&imagetools';
import heroUrl from '../images/hero.jpg?w=400&format=webp&imagetools';
import heroGallery from '../images/hero.jpg?w=300;600&format=webp&imagetools-gallery';
// the source is 1600px wide: 3000 clamps to 1600, and the import must still be an array of two
import heroClamped from '../images/hero.jpg?w=1600;3000&format=webp&imagetools-gallery';
import heroThumb from '../images/hero.jpg?preset=thumb&imagetools';
import heroInline from '../images/hero.jpg?w=24&format=webp&inline&imagetools';
// custom output format from imagetools.config.mjs
import heroDims from '../images/hero.jpg?w=100;200&format=webp&as=dims';
import heroSrcset from '../images/hero.jpg?w=300;600;900&format=webp&as=srcset';
import heroPicture from '../images/hero.jpg?w=400;800&format=avif;webp;jpg&as=picture';
import heroMeta, {
  src as namedSrc,
  width as namedWidth,
} from '../images/hero.jpg?w=500&format=webp&as=metadata&imagetools';
import heroNext from '../images/hero.jpg?w=300;600&format=webp&as=next';
import heroPlaceholder from '../images/hero.jpg?w=320&h=320&fit=cover&format=webp&placeholder&as=img';
import plain from '../images/hero.jpg';
import spacedSrcset from '../images/my photo (1).jpg?w=40;80&format=webp&as=srcset';
// excluded in next.config.ts: the query is ignored and Next.js returns its usual StaticImageData
import excluded from '../images/raw/photo.jpg?w=10&format=webp&imagetools';
import Hidden from './hidden';
import { typed } from './typed';

// Rendered by every route in the mode matrix (static, SSR, edge, CSR, Pages Router, export).
export default function ImageGrid({ mode }: { mode: string }) {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1 id="mode">{mode}</h1>

      <h2>url</h2>
      <img id="url" src={heroUrl} alt="" />

      <h2>srcset</h2>
      <img id="srcset" srcSet={heroSrcset} sizes="300px" alt="" />

      <h2>picture</h2>
      <picture id="picture">
        {Object.entries(heroPicture.sources).map(([type, srcset]) => (
          <source key={type} type={`image/${type}`} srcSet={srcset} />
        ))}
        <img
          src={heroPicture.img.src}
          width={heroPicture.img.w}
          height={heroPicture.img.h}
          alt=""
        />
      </picture>

      <h2>as=next with a blur placeholder, through next/image</h2>
      {/* no `unoptimized`: the usual next/image path, optimizer included */}
      <Image id="next" src={heroNext} placeholder="blur" sizes="300px" alt="" />
      <img
        id="placeholder"
        src={heroPlaceholder.src}
        width={heroPlaceholder.w}
        height={heroPlaceholder.h}
        style={{ backgroundImage: `url(${heroPlaceholder.placeholder})`, backgroundSize: 'cover' }}
        alt=""
      />

      <h2>metadata + next/image</h2>
      <Image
        id="meta"
        src={heroMeta.src}
        width={heroMeta.width}
        height={heroMeta.height}
        alt=""
        unoptimized
      />

      <h2>plain import (Next default)</h2>
      <Image src={plain} width={200} alt="" unoptimized />

      <h2>file names that need encoding</h2>
      <img id="accented" src={accented} alt="" />
      <img id="spaced" srcSet={spacedSrcset} sizes="40px" alt="" />

      <h2>client-only (rendered after a click)</h2>
      <Hidden />

      <script
        id="imports"
        type="application/json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            heroUrl,
            heroGallery,
            heroClamped,
            heroThumb,
            heroInline,
            heroDims,
            accented,
            spacedSrcset,
            excluded,
            named: { src: namedSrc, width: namedWidth },
            heroSrcset,
            heroPicture,
            heroMeta,
            plain,
            heroNext,
            heroPlaceholder,
            typed,
          }),
        }}
      />
    </main>
  );
}
