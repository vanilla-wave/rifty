# No-COI recovery copy evidence

Baseline: 59df0c0a3, Node v24.16.0, pnpm 11.5.2, Vitest 2.1.9,
Playwright 1.60.0 Chromium, macOS arm64. 2026-09-06.

## RED

`pnpm exec vitest run packages/runtime-js/src/host-recovery.fault.test.ts`

2 failed, 6 passed. Write copy counter: expected 3, actual 1048581;
same-OPFS restore expected no files, actual full 2-file recovery tree.
Other backend pairs, ordered writes, caller isolation, quota rejection and
peer-death preservation passed on baseline.

`RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi -g 'recovery copies scale'`

1 failed on three cost assertions; Vite installed, served, restarted, served
its saved marker. Public source edit copied 29,528,068 untouched bytes
(expected 0). Same-OPFS restore posted 269 files (expected 0). Install copied
59,056,136 bytes; restart copied 88,584,213 bytes. With one input snapshot and
one restore-input copy, restart must equal twice the sole install copy plus
the exact source-byte delta. All failures were assertion failures, no
import/typecheck/timeout failures.

No Node filesystem behavior changes: restart is SDK-specific, owned by
ADR-0377 D2. Existing alias tests and real memory Vite restart are regression
oracles. Byte copies at external caller boundaries remain deliberate.

## Journal

2026-09-06 — runtime-js/no-coi-recovery-copy band 3–4 rounds 2; standalone pickup.
