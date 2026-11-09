/// <reference types="turbopack-imagetools/client" />

// the fixture's custom output format (see imagetools.config.mjs)
declare module '*as=dims' {
  const dims: { w: number; h?: number }[];
  export default dims;
}
