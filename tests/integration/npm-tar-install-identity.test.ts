import { expect, it } from 'vitest';

it('invalidates materialized trees produced by the package-prefix-only extractor', async () => {
  const { buildInstallArtifactIdentityFile } = await import(
    '../../tools/shadow-registry/tools/generate-install-artifact-identity.ts'
  );
  // Captured before the npm strip-one repair; old trees misplace DefinitelyTyped declarations.
  expect((await buildInstallArtifactIdentityFile()).identity).not.toBe(
    'sha256:6f5f3cc69c25254d3b73a5162e32b3e621c30ee6ae433329e966c15d6bad2489',
  );
});
