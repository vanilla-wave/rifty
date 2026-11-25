/**
 * A sandbox template (goal `isolate-host-sandbox-template`): a `produceDependencySnapshot`
 * artifact whose `payload/node_modules` becomes a new sandbox's own files at `/node_modules`.
 */

/** A registered template: the artifact's `templateId` and its `snapshotId` (sha256 of the tar). */
export interface TemplateIdentity {
  readonly id: string;
  readonly version: string;
}

/** Decode `artifact` once for this process; `createSandbox({ template })` then takes the identity. */
export function registerTemplate(artifact: Uint8Array): Promise<TemplateIdentity> {
  void artifact;
  const error = new Error(
    'Not implemented: isolate-host.sandbox-template (a sandbox starts empty or from its own snapshot, ADR-0568)',
  );
  error.name = 'NotImplementedError';
  return Promise.reject(Object.assign(error, { feature: 'isolate-host.sandbox-template' }));
}

const decodes = 0;
/** Artifacts decoded in this process (a test seam for the once-per-process rule). */
export function decodeCount(): number {
  return decodes;
}
