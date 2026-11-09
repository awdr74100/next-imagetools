'use client';

import { useState } from 'react';

import large from '../images/landscape.jpg?w=1800&format=webp&as=metadata&imagetools';

export function Zoom() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <pre>{`'use client';
import large from './landscape.jpg?w=1800&format=webp&as=metadata&imagetools';`}</pre>
      {open ? (
        <img src={large.src} width={large.width} height={large.height} alt="Hills at dusk" />
      ) : (
        <button onClick={() => setOpen(true)}>Show the 1800px version</button>
      )}
    </>
  );
}
