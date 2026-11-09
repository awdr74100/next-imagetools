// Fixture config file: a custom output format, exercised by every rendering mode. The dev suite
// rewrites this file while `next dev` runs and expects the change to show up.
export default {
  extendOutputFormats: builtins => ({
    ...builtins,
    dims: () => images => images.map(image => ({ w: image.info.width })),
  }),
};
