import type { ImageConfig, OutputFormat, TransformFactory } from 'imagetools-core';
import type { Metadata } from 'sharp';

/**
 * Options that take functions. Turbopack passes loader options to worker processes as JSON, so
 * these live in a module of their own — referenced by `configFile` — that each worker imports.
 */
export interface ImagetoolsConfig {
  /** Add or replace transforms; receives the built-in transform factories. */
  extendTransforms?: (builtins: TransformFactory[]) => TransformFactory[];
  /**
   * Add or replace output formats (`as=<name>`); receives the built-in ones. A format's result is
   * serialized into the importing module, so it must be JSON-serializable.
   */
  extendOutputFormats?: (builtins: Record<string, OutputFormat>) => Record<string, OutputFormat>;
  /** Replace how directives expand into the list of images to generate. */
  resolveConfigs?: (
    entries: [string, string[]][],
    outputFormats: Record<string, OutputFormat>,
  ) => ImageConfig[] | undefined;
  /**
   * Directives that depend on the image. Applied beneath the preset and the query, above the
   * `defaultDirectives` option. `url` is the source path with its query; `metadata` reads the
   * source's sharp metadata on first call.
   */
  defaultDirectives?: (
    url: URL,
    metadata: () => Promise<Metadata>,
  ) => URLSearchParams | Promise<URLSearchParams>;
}

/** Identity helper that types an imagetools config file. */
export function defineConfig(config: ImagetoolsConfig): ImagetoolsConfig {
  return config;
}
