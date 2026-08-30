import type { Page } from '@playwright/test';

export interface ConsumedResponse {
  pathname: string;
  status: number;
  /** Request `Sec-Fetch-Dest` (browser-added; settled async) — null until settled. */
  dest: string | null;
  coop: string | null;
  coep: string | null;
}
/** Expected consumption: pathname + the request destination that consumed it. */
export interface ConsumedClass {
  path: string;
  dest: string;
}
export type ConsumedClassSummary = Record<
  string,
  { status: number; coop: string | null; coep: string | null } | null
>;

export declare const CONSUMED_CLASSES: {
  page: Record<'document' | 'probeModule' | 'builtShim' | 'builtUtilTypes', ConsumedClass>;
  worker: Record<
    'document' | 'workerScript' | 'probeModule' | 'builtShim' | 'builtUtilTypes',
    ConsumedClass
  >;
  kernelDriver: Record<'document' | 'kernelPublic' | 'kernelStdioDrain', ConsumedClass>;
};
export interface ConsumedResponseCapture {
  settle(): Promise<ConsumedResponse[]>;
}
export declare function captureConsumedResponses(page: Page): ConsumedResponseCapture;
export declare function summarizeConsumedResponses(
  responses: ConsumedResponse[],
  classes: Record<string, ConsumedClass>,
): ConsumedClassSummary;
export declare function assertHeaderlessConsumption(
  responses: ConsumedResponse[],
  classes: Record<string, ConsumedClass>,
): void;
