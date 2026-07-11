export interface PreviewRoute {
  readonly port: number;
  readonly previewScope?: string;
}

export type MountPreviewRoute = (
  port: number,
  ownerToken: string,
  previewScope?: string,
) => () => void;

export interface PreviewRouteSet {
  reconcile(ownerToken: string, routes: readonly PreviewRoute[]): void;
  clear(): void;
  dispose(): void;
}

interface MountedRoute {
  readonly tearDown: () => void;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function previewRouteKey(ownerToken: string, route: PreviewRoute): string {
  return JSON.stringify([ownerToken, route.port, route.previewScope ?? null]);
}

export class PreviewRouteSetError extends AggregateError {
  constructor(
    readonly operation: 'mount' | 'teardown',
    errors: readonly Error[],
  ) {
    super(errors, errors.map((error) => error.message).join('; '));
    this.name = 'PreviewRouteSetError';
  }
}

function throwCollected(operation: 'mount' | 'teardown', errors: readonly Error[]): void {
  if (errors.length === 0) return;
  throw new PreviewRouteSetError(operation, errors);
}

/** One owner-token/port/scope route registry shared by app and embed lifecycles. */
export function createPreviewRouteSet(options: {
  readonly mountBridge: MountPreviewRoute;
}): PreviewRouteSet {
  const mounted = new Map<string, MountedRoute>();
  let disposed = false;

  const assertAlive = (): void => {
    if (disposed) throw new Error('preview route set disposed');
  };

  const tearWhere = (shouldTear: (key: string) => boolean): void => {
    const errors: Error[] = [];
    for (const [key, route] of mounted) {
      if (!shouldTear(key)) continue;
      try {
        route.tearDown();
      } catch (error) {
        errors.push(asError(error));
      } finally {
        mounted.delete(key);
      }
    }
    throwCollected('teardown', errors);
  };

  return {
    reconcile(ownerToken, routes) {
      assertAlive();
      const live = new Set(routes.map((route) => previewRouteKey(ownerToken, route)));
      tearWhere((key) => !live.has(key));

      const errors: Error[] = [];
      for (const route of routes) {
        const key = previewRouteKey(ownerToken, route);
        if (mounted.has(key)) continue;
        try {
          mounted.set(key, {
            tearDown: options.mountBridge(route.port, ownerToken, route.previewScope),
          });
        } catch (error) {
          errors.push(asError(error));
        }
      }
      throwCollected('mount', errors);
    },
    clear() {
      assertAlive();
      tearWhere(() => true);
    },
    dispose() {
      if (disposed) return;
      try {
        tearWhere(() => true);
      } finally {
        disposed = true;
      }
    },
  };
}
