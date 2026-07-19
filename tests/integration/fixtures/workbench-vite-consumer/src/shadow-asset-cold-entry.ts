import {
  type ShadowAssetColdMeasurementOptions,
  type ShadowAssetColdPageEvidence,
  closeShadowAssetCold,
  measureShadowAssetCold,
  prepareShadowAssetCold,
} from './shadow-asset-cold';

export interface ShadowAssetColdPagePort {
  prepare(options: ShadowAssetColdMeasurementOptions): Promise<void>;
  measure(): Promise<ShadowAssetColdPageEvidence>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    __RIFTY_SHADOW_ASSET_COLD__: ShadowAssetColdPagePort;
  }
}

window.__RIFTY_SHADOW_ASSET_COLD__ = Object.freeze({
  prepare: prepareShadowAssetCold,
  measure: measureShadowAssetCold,
  close: closeShadowAssetCold,
});

const status = document.querySelector('#status');
if (status === null) throw new Error('shadow-asset cold document is missing #status');
status.textContent = 'ready';
