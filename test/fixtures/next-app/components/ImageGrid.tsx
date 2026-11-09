import Image from 'next/image';

import heroUrl from '../images/hero.jpg?w=400&format=webp&imagetools';
import heroGallery from '../images/hero.jpg?w=300;600&format=webp&imagetools-gallery';
import heroSrcset from '../images/hero.jpg?w=300;600;900&format=webp&as=srcset';
import heroPicture from '../images/hero.jpg?w=400;800&format=avif;webp;jpg&as=picture';
import heroMeta from '../images/hero.jpg?w=500&format=webp&as=metadata&imagetools';
import plain from '../images/hero.jpg';
import Hidden from './hidden';

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

      <h2>client-only (rendered after a click)</h2>
      <Hidden />

      <script
        id="imports"
        type="application/json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            heroUrl,
            heroGallery,
            heroSrcset,
            heroPicture,
            heroMeta,
            plain,
          }),
        }}
      />
    </main>
  );
}
