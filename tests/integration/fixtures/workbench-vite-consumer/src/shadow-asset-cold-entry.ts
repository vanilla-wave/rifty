import {
  type ShadowAssetColdMeasurementOptions,
  type ShadowAssetColdPageEvidence,
  measureShadowAssetCold,
} from './shadow-asset-cold';

export interface ShadowAssetColdPagePort {
  measure(options: ShadowAssetColdMeasurementOptions): Promise<ShadowAssetColdPageEvidence>;
}

declare global {
  interface Window {
    __RIFTY_SHADOW_ASSET_COLD__: ShadowAssetColdPagePort;
  }
}

window.__RIFTY_SHADOW_ASSET_COLD__ = Object.freeze({
  measure: measureShadowAssetCold,
});

const status = document.querySelector('#status');
if (status === null) throw new Error('shadow-asset cold document is missing #status');
status.textContent = 'ready';
