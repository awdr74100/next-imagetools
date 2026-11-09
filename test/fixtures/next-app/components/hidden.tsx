'use client';
import { useState } from 'react';

import secret from '../images/hero.jpg?w=250&h=250&fit=cover&format=webp&imagetools';

// rendered only after a click — the case that 404s with nuxt/image SSG
export default function Hidden() {
  const [show, setShow] = useState(false);
  return (
    <div>
      <button onClick={() => setShow(true)}>show</button>
      {show && <img id="hidden" src={secret} alt="" />}
      <span id="hidden-src" data-src={secret} />
    </div>
  );
}
