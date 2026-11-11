'use client';
import { useEffect, useRef, useState } from 'react';

import secret from '../images/hero.jpg?w=250&h=250&fit=cover&format=webp&imagetools';

// rendered only after a click — the case that 404s with nuxt/image SSG
export default function Hidden() {
  const [show, setShow] = useState(false);
  // marks the button once React has hydrated it: a click before that is lost, which `next dev`,
  // compiling the client bundle on the first request, made the mode suite hit now and then
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => button.current?.setAttribute('data-hydrated', ''), []);
  return (
    <div>
      <button ref={button} onClick={() => setShow(true)}>
        show
      </button>
      {show && <img id="hidden" src={secret} alt="" />}
      <span id="hidden-src" data-src={secret} />
    </div>
  );
}
