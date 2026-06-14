export interface PreviewSessionLike {
  readonly port: number;
}

export interface PreviewBindingOptions {
  readonly session?: PreviewSessionLike;
  readonly port?: number;
}

export interface PreviewBinding {
  readonly port: number;
  readonly url: string;
  dispose(): void;
}

export function previewUrlForPort(port: number): string {
  return `/preview/${port}/`;
}

export function createPreviewBinding(opts: PreviewBindingOptions): PreviewBinding {
  const port = opts.port ?? opts.session?.port;
  if (port === undefined) {
    throw new Error('createPreviewBinding: expected session or port');
  }
  let disposed = false;
  return {
    port,
    url: previewUrlForPort(port),
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  };
}
