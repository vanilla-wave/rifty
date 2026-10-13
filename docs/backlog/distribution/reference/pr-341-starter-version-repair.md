# PR341 — restore starter Vite admission

Observed baseline3c50ca9b2; exact CImergea2401db07 tree equals HEAD.
CI38072834304/38072806246:five heavy e2e fail after fresh React install;
executed Vite7.3.7 rejected by existing exact7.3.6 runtime admission.
Independent local CImerge deep-link reproduces the same loud error.

Fault:starter request→registry resolution→runtime admission, frozen-assumption/
sibling-drift. Both Vite and React declare ^7.0.0; TypeScript inherits Vite.
Existing runtime admission is correct and unchanged. Fix the starter owner:
one DEFAULT_VITE7_VERSION in existing playground policy, allthree seeds use
7.3.6. Imported/manual projects retain ordinary dependency resolution and
unsupported-version failures. Installed Vite CLI owns dev/build/preview
(ADR-0078/0174); no wrapper, broadened runtime gate or new dependency.

Regression before sourcefix:three actual generated starter package.json requests
select unsupported7.3.7; two baked requests retain oldrange —5RED. Sourcepins
alone:3GREEN/2snapshotRED. Actual existing installer/finalizer/bake code rebuilds
only Vite/TypeScript payloads; other artifacts/identities byteexact unchanged.
Transitive versions update from realregistry (retained audit), not claimed
identical. Installed Vite remains7.3.6; Rollup/@rollup/wasm-node versions match.

Owning reverts:oldrange→3RED, oldpayloads→2RED; exact fixedbytes restored.
Template/package portability/bakedidentity suite63PASS. Original heavy e2e
assertions remain unchanged. Existing two exact-range expectations now reflect
the admitted dependency request; no functional assertion weakened.

## Fault matrix

| axis × operation | required observable result | proof |
|---|---|---|
| frozen-assumption × seed resolution | later unsupportedpatch cannot win starter selection | three generatedpackage resolver guards; local/CI RED |
| sibling-drift × Vite/React/TypeScript seed | all admitted starter requests use same supportedversion | registry-wide three guards/shared existingpolicy |
| stale/mismatched baked request × restore | request/installedVite/identity agree | two payloadguards, owningrevertRED, realrebake, unchanged identity contract |

Bounded fix after accepted goal CLOSE; all measured campaign scores/headers/
archives remain immutable. Current source acceptance does not rescore history.
Final independent review and current CI determine readiness.

Raw original CI/local RED/bake/revert/63unit and unchanged5e2eGREEN:
`pr-341-starter-version-repair-proof.json.gz`. Five browser scenarios PASS
without retries (2.0m):coldinstall/deeplink,dev/HMR,build/preview,+chat,leafedit.

Current fullpr:check27PASS (unit214.4s:one timeout passed required isolated
retry; parity117.2s). Actual cached default/TypeScript starter tests2PASS
(13.5s), including TypeScript entry edit→served Vite output. No browser retries.
