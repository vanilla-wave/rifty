# Client budget proof

`pnpm test:client-bundles --keep`: GREEN on real 15 first-party + 72 external
tarballs, strict TypeScript, minified splitting bundles and fresh Chromium.
Compiler boot/eval/preload/fetch-fault, VM defaults/HTTP/Blob/readiness/WASM-fault,
SDK io/backend/source-wrapper, and install/restore/fetch-fault/busy proofs pass.

| Artifact | min / ceiling B | gzip / ceiling B |
|---|---:|---:|
| main | 56861 / 86000 | 18033 / 28000 |
| sw | 14056 / 22000 | 4828 / 8000 |
| generic | 725778 / 1089000 | 213598 / 321000 |
| toolchain | 796895 / 1196000 | 236199 / 355000 |

Every historical leak in the adjacent JSON crosses both ceilings. Focused
budget suite 4/4: ≥50% headroom, eight historical min/gzip failures + two
compiler guards, missing artifacts/provenance/observations, omitted actually
requested QuickJS bootstrap JS. Raw reports and request ledgers were copied
from the accepted real packed runs, not hand-generated graph fixtures.

CI's no-COI job runs the command; pr-check.mjs remains unchanged (25 lanes).
The first command invocation exposed its existing CLI allowlist; the new flag
is admitted there and the complete rerun passed. No product behavior changed.
