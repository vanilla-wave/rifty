import type { Page } from '@playwright/test';

export interface ConsumedResponse {
  pathname: string;
  status: number;
  coop: string | null;
  coep: string | null;
}
export type ConsumedClassSummary = Record<
  string,
  { status: number; coop: string | null; coep: string | null } | null
>;

export declare const CONSUMED_CLASSES: {
  page: Record<'document' | 'probeModule' | 'builtShim' | 'builtUtilTypes', string>;
  worker: Record<
    'document' | 'workerScript' | 'probeModule' | 'builtShim' | 'builtUtilTypes',
    string
  >;
};
export declare function captureConsumedResponses(page: Page): ConsumedResponse[];
export declare function summarizeConsumedResponses(
  responses: ConsumedResponse[],
  classes: Record<string, string>,
): ConsumedClassSummary;
export declare function assertHeaderlessConsumption(
  responses: ConsumedResponse[],
  classes: Record<string, string>,
): void;
