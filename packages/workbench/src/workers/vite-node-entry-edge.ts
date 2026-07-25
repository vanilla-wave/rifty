import {
  type ViteCliPreparation,
  prepareViteCli,
  viteCliPreparationFromArgs,
} from './vite-cli-prep.ts';

export interface NodeEntryIntegrationPlan {
  /** False only when the concrete consumer must run without runtime adapters. */
  readonly activateRuntimeAdapters: boolean;
  complete(): Promise<void>;
}

const NO_CONCRETE_INTEGRATION: NodeEntryIntegrationPlan = Object.freeze({
  activateRuntimeAdapters: true,
  complete: async () => {},
});

function planned(preparation: ViteCliPreparation): NodeEntryIntegrationPlan {
  return Object.freeze({
    // ADR-0226: informational Vite invocations validate their prepared tree,
    // but never start or publish esbuild.
    activateRuntimeAdapters: preparation.mode !== 'info',
    complete: async () => prepareViteCli(preparation),
  });
}

/** Concrete Vite recognition and its adapter-before-CLI ordering decision. */
export function planViteNodeEntryEdge(options: {
  readonly bin: boolean;
  readonly root: string;
  readonly args: readonly string[];
  readonly entryPath: string;
}): NodeEntryIntegrationPlan {
  if (!options.bin) return NO_CONCRETE_INTEGRATION;
  const preparation = viteCliPreparationFromArgs({
    root: options.root,
    args: options.args,
    executedBinPath: options.entryPath,
  });
  return preparation === null ? NO_CONCRETE_INTEGRATION : planned(preparation);
}
