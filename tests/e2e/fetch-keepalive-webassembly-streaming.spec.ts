import { fileURLToPath } from 'node:url';
import { type Page, expect, test } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const fetchKeepaliveModuleUrl = `/@fs${repoRoot}/packages/runtime-js/src/builtins/fetch-keepalive.ts`;
const eventLoopModuleUrl = `/@fs${repoRoot}/packages/runtime-js/src/internal/event-loop-keepalive.ts`;

type Carrier = 'direct' | 'promise' | 'untracked' | 'untracked-clone' | 'untracked-promise';
type StreamingApi = 'compileStreaming' | 'instantiateStreaming';
type PriorityCase = 'invalid-imports' | 'malformed-source';

const EMPTY_WASM = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00] as const;

async function runStreamingCeilingCase(page: Page, api: StreamingApi, carrier: Carrier) {
  await page.goto('/unit-harness.html');
  return await page.evaluate(
    async ({ api, carrier, eventLoopUrl, fetchKeepaliveUrl, validWasm }) => {
      const [{ installFetchKeepalive }, { activeRefs, awaitDrain, resetKeepalive }] =
        (await Promise.all([
          import(/* @vite-ignore */ fetchKeepaliveUrl),
          import(/* @vite-ignore */ eventLoopUrl),
        ])) as [
          {
            installFetchKeepalive(target: {
              fetch: typeof fetch;
              WebAssembly: typeof WebAssembly;
            }): void;
          },
          {
            activeRefs(): number;
            awaitDrain(options: { capMs: number }): Promise<void>;
            resetKeepalive(): void;
          },
        ];
      const trackedResponse = new Response(new ReadableStream<Uint8Array>(), {
        headers: { 'content-type': 'application/wasm' },
      });
      const target = {
        fetch: (() => Promise.resolve(trackedResponse)) as typeof fetch,
        WebAssembly: Object.create(globalThis.WebAssembly) as typeof WebAssembly,
      };
      installFetchKeepalive(target);

      const errorShape = (error: unknown) => {
        const feature =
          error !== null && typeof error === 'object' && 'feature' in error
            ? (error as { feature?: unknown }).feature
            : undefined;
        return {
          feature: typeof feature === 'string' ? feature : null,
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : typeof error,
        };
      };
      const captureDrain = async (): Promise<string | null> => {
        try {
          await awaitDrain({ capMs: 30 });
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      };
      const invoke = (
        source: Response | PromiseLike<Response>,
      ): {
        operation: Promise<unknown> | null;
        syncError: ReturnType<typeof errorShape> | null;
      } => {
        try {
          return {
            operation:
              api === 'instantiateStreaming'
                ? target.WebAssembly.instantiateStreaming(source, {})
                : target.WebAssembly.compileStreaming(source),
            syncError: null,
          };
        } catch (error) {
          return { operation: null, syncError: errorShape(error) };
        }
      };
      const settle = async (operation: Promise<unknown> | null) => {
        if (operation === null) return { kind: 'no-promise' as const };
        return await operation.then(
          () => ({ kind: 'success' as const }),
          (error) => ({ error: errorShape(error), kind: 'error' as const }),
        );
      };

      const secondaryUnhandledRejections: ReturnType<typeof errorShape>[] = [];
      const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        event.preventDefault();
        secondaryUnhandledRejections.push(errorShape(event.reason));
      };
      globalThis.addEventListener('unhandledrejection', onUnhandledRejection);

      try {
        const fetchResult = target.fetch('https://controlled.invalid/streaming-ceiling.wasm');
        const exactResponse = await fetchResult;
        const exactReader = exactResponse.body!.getReader();
        const untrackedResponse = new Response(new Uint8Array(validWasm), {
          headers: { 'content-type': 'application/wasm' },
        });
        const clonedResponse = untrackedResponse.clone();
        const untrackedPromise = Promise.resolve(untrackedResponse);
        const untrackedPromiseLike: PromiseLike<Response> = {
          then(onfulfilled, onrejected) {
            return untrackedPromise.then(onfulfilled, onrejected);
          },
        };
        const source =
          carrier === 'direct'
            ? exactResponse
            : carrier === 'promise'
              ? fetchResult
              : carrier === 'untracked-clone'
                ? clonedResponse
                : carrier === 'untracked'
                  ? untrackedResponse
                  : untrackedPromiseLike;
        const refsBeforeInvoke = activeRefs();
        const call = invoke(source);
        const outcome = await settle(call.operation);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const beforeCancel = {
          cloneBodyUsed: clonedResponse.bodyUsed,
          drainError: await captureDrain(),
          refs: activeRefs(),
          untrackedBodyUsed: untrackedResponse.bodyUsed,
        };

        let cancelError: ReturnType<typeof errorShape> | null = null;
        try {
          await exactReader.cancel('exact tracked reader canceled');
        } catch (error) {
          cancelError = errorShape(error);
        }
        await Promise.resolve();
        const afterCancel = {
          drainError: await captureDrain(),
          refs: activeRefs(),
        };
        return {
          afterCancel,
          beforeCancel,
          cancelError,
          outcome,
          refsBeforeInvoke,
          returnedPromise: call.operation instanceof Promise,
          secondaryUnhandledRejections,
          syncError: call.syncError,
        };
      } finally {
        globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
        resetKeepalive();
      }
    },
    {
      api,
      carrier,
      eventLoopUrl: eventLoopModuleUrl,
      fetchKeepaliveUrl: fetchKeepaliveModuleUrl,
      validWasm: EMPTY_WASM,
    },
  );
}

async function runErrorPriorityCase(page: Page, api: StreamingApi, fault: PriorityCase) {
  await page.goto('/unit-harness.html');
  return await page.evaluate(
    async ({ api, fault, fetchKeepaliveUrl, validWasm }) => {
      const { installFetchKeepalive } = (await import(/* @vite-ignore */ fetchKeepaliveUrl)) as {
        installFetchKeepalive(target: {
          fetch: typeof fetch;
          WebAssembly: typeof WebAssembly;
        }): void;
      };
      const target = {
        fetch: globalThis.fetch.bind(globalThis),
        WebAssembly: Object.create(globalThis.WebAssembly) as typeof WebAssembly,
      };
      installFetchKeepalive(target);
      const errorShape = (error: unknown) => {
        const feature =
          error !== null && typeof error === 'object' && 'feature' in error
            ? (error as { feature?: unknown }).feature
            : undefined;
        return {
          feature: typeof feature === 'string' ? feature : null,
          message: error instanceof Error ? error.message : String(error),
          name: error instanceof Error ? error.name : typeof error,
        };
      };
      const validResponse = new Response(new Uint8Array(validWasm), {
        headers: { 'content-type': 'application/wasm' },
      });
      const source = fault === 'malformed-source' ? (42 as unknown as Response) : validResponse;
      let operation: Promise<unknown> | null = null;
      let syncError: ReturnType<typeof errorShape> | null = null;
      try {
        operation =
          api === 'compileStreaming'
            ? target.WebAssembly.compileStreaming(source)
            : target.WebAssembly.instantiateStreaming(
                source,
                fault === 'invalid-imports' ? (null as unknown as WebAssembly.Imports) : {},
              );
      } catch (error) {
        syncError = errorShape(error);
      }
      const secondaryUnhandledRejections: ReturnType<typeof errorShape>[] = [];
      const onUnhandledRejection = (event: PromiseRejectionEvent) => {
        event.preventDefault();
        secondaryUnhandledRejections.push(errorShape(event.reason));
      };
      globalThis.addEventListener('unhandledrejection', onUnhandledRejection);
      try {
        const outcome =
          operation === null
            ? { kind: 'no-promise' as const }
            : await operation.then(
                () => ({ kind: 'success' as const }),
                (error) => ({ error: errorShape(error), kind: 'error' as const }),
              );
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        return {
          bodyUsed: validResponse.bodyUsed,
          outcome,
          returnedPromise: operation instanceof Promise,
          secondaryUnhandledRejections,
          syncError,
        };
      } finally {
        globalThis.removeEventListener('unhandledrejection', onUnhandledRejection);
      }
    },
    { api, fault, fetchKeepaliveUrl: fetchKeepaliveModuleUrl, validWasm: EMPTY_WASM },
  );
}

async function runFunctionDescriptorCase(page: Page) {
  await page.goto('/unit-harness.html');
  return await page.evaluate(
    async ({ fetchKeepaliveUrl }) => {
      const { installFetchKeepalive } = (await import(/* @vite-ignore */ fetchKeepaliveUrl)) as {
        installFetchKeepalive(target: {
          fetch: typeof fetch;
          WebAssembly: typeof WebAssembly;
        }): void;
      };
      const target = {
        fetch: globalThis.fetch.bind(globalThis),
        WebAssembly: Object.create(globalThis.WebAssembly) as typeof WebAssembly,
      };
      const findDescriptor = (object: object, key: PropertyKey): PropertyDescriptor => {
        let owner: object | null = object;
        while (owner !== null) {
          const descriptor = Object.getOwnPropertyDescriptor(owner, key);
          if (descriptor !== undefined) return descriptor;
          owner = Object.getPrototypeOf(owner) as object | null;
        }
        throw new Error(`missing descriptor: ${String(key)}`);
      };
      const descriptorShape = (descriptor: PropertyDescriptor) => ({
        configurable: descriptor.configurable ?? null,
        enumerable: descriptor.enumerable ?? null,
        hasGetter: typeof descriptor.get === 'function',
        hasSetter: typeof descriptor.set === 'function',
        valueType: 'value' in descriptor ? typeof descriptor.value : null,
        writable: 'writable' in descriptor ? (descriptor.writable ?? null) : null,
      });
      const functionShape = (name: StreamingApi) => {
        const operation = target.WebAssembly[name];
        return {
          length: operation.length,
          methodDescriptor: descriptorShape(findDescriptor(target.WebAssembly, name)),
          name: operation.name,
          ownDescriptors: Reflect.ownKeys(operation).map((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(operation, key);
            if (descriptor === undefined) throw new Error(`missing own descriptor: ${String(key)}`);
            return {
              descriptor: descriptorShape(descriptor),
              key: typeof key === 'symbol' ? key.toString() : key,
              primitiveValue:
                'value' in descriptor &&
                (typeof descriptor.value === 'string' || typeof descriptor.value === 'number')
                  ? descriptor.value
                  : null,
            };
          }),
        };
      };
      const before = {
        compileStreaming: functionShape('compileStreaming'),
        instantiateStreaming: functionShape('instantiateStreaming'),
      };
      installFetchKeepalive(target);
      const after = {
        compileStreaming: functionShape('compileStreaming'),
        instantiateStreaming: functionShape('instantiateStreaming'),
      };
      return { after, before };
    },
    { fetchKeepaliveUrl: fetchKeepaliveModuleUrl },
  );
}

for (const api of ['compileStreaming', 'instantiateStreaming'] as const) {
  for (const carrier of [
    'direct',
    'promise',
    'untracked',
    'untracked-clone',
    'untracked-promise',
  ] as const) {
    test(`Chromium WebAssembly.${api} ${carrier} carrier hits the realm-wide streaming ceiling`, async ({
      browserName,
      page,
    }) => {
      test.skip(browserName !== 'chromium', 'Rifty targets fresh Chromium');
      const result = await runStreamingCeilingCase(page, api, carrier);
      const feature = `WebAssembly.${api}`;

      expect(result.syncError).toBeNull();
      expect(result.returnedPromise).toBe(true);
      expect(result.outcome).toEqual({
        error: {
          feature,
          message: `Not implemented: ${feature}`,
          name: 'NotImplementedError',
        },
        kind: 'error',
      });
      expect(result.secondaryUnhandledRejections).toEqual([]);
      expect(result.refsBeforeInvoke).toBe(1);
      expect(result.beforeCancel).toMatchObject({
        cloneBodyUsed: false,
        refs: 1,
        untrackedBodyUsed: false,
      });
      expect(result.beforeCancel.drainError).toContain('1 active ref(s)');
      expect(result.cancelError).toBeNull();
      expect(result.afterCancel).toEqual({ drainError: null, refs: 0 });
    });
  }
}

const errorPriorityCases = [
  { api: 'compileStreaming', fault: 'malformed-source' },
  { api: 'instantiateStreaming', fault: 'malformed-source' },
  { api: 'instantiateStreaming', fault: 'invalid-imports' },
] as const satisfies readonly { api: StreamingApi; fault: PriorityCase }[];

for (const scenario of errorPriorityCases) {
  test(`Chromium WebAssembly.${scenario.api} ceiling wins over ${scenario.fault}`, async ({
    browserName,
    page,
  }) => {
    test.skip(browserName !== 'chromium', 'Rifty targets fresh Chromium');
    const result = await runErrorPriorityCase(page, scenario.api, scenario.fault);
    const feature = `WebAssembly.${scenario.api}`;

    expect(result.syncError).toBeNull();
    expect(result.returnedPromise).toBe(true);
    expect(result.outcome).toEqual({
      error: {
        feature,
        message: `Not implemented: ${feature}`,
        name: 'NotImplementedError',
      },
      kind: 'error',
    });
    expect(result.secondaryUnhandledRejections).toEqual([]);
    expect(result.bodyUsed).toBe(false);
  });
}

test('Chromium WebAssembly streaming ceiling preserves effective property, name, length, and own descriptors', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Rifty targets fresh Chromium');
  const result = await runFunctionDescriptorCase(page);

  expect(result.after).toEqual(result.before);
});
