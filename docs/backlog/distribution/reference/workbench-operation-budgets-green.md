# I7 implementation / proof

ADR-0410 through existing owners: one normalized/frozen B/F/T/S/P input,
strict integer boot B/IO/P, explicit-only shared IO maximum, current startup/
file/tool/drain deadlines. No new timer owner, queue, retries or global policy.
Existing omissions30s startup/proof/report,35s ACK,60s file/tools/silence remain.
File states still precede ACK; timeout/death retain applied/unknown semantics.

## Direct proof

- Root56/56 new unit carriers GREEN,2.38s; after all revert checks restored,
 56/56GREEN2.16s. `/tmp/rifty-316-i7-core-{green,restored-green}.log`.
- VFS/storage100PASS/1existing skip; VFS/Workbench typesGREEN. Native8/8GREEN7.1s:
  public B90 close/read/cleanup, shared default installer, native90/10/default30,
 16lanes/same-path/capacity and exact late healing. Source/options captured before
  async mount, no caller mutation changes an installed instance.
- Native scheduler-only revert to30k:2semanticRED/1defaultPASS5.3s; exact source
  restoration84b9d6f25c87f6495ad6f2a052acd8ec783a3f5169c5ebef13ddc3270c0e61d8
  →native3/3GREEN5.0s. AppSW remained de38baa…91f5cf. Full commands:
  workbench-operation-budgets-storage-proof.md.
- Root separate reverts:35s fileACK,60s file phase,60s tools, public overflow,
  wire overflow and wire fractional admission each semanticRED; exact source
  restored after each. The70s case independently killed the coordinator60s
  sibling while ACK90 remained enabled. No criteria changes. Commands/hashes:
  `/tmp/rifty-316-i7-core-revert-check.{py,json,log}` and six `-revert-*.log`.
- Source-size holds: browser owner1189wc/gate1190, OPFS1167wc/gate1168 under
 1190pin. Existing stderr decoder renamed concisely; redundant silence comment
  removed. No growth exemption/new source-size pin.

## Full gate discovery / repair

First I7 fullgate23/25: exact TypeScript-worker pin drift and one introduced
validation-message regression.10,209unit cases passed; open-workbench.test
failed once and repeated in required isolated85case rerun. Existing test
requires the shared zero/invalid budget diagnostic `must be a positive finite
number`. Preserve it in production; upper-bound rejection remains separate.
No test edit.85old+56I7 =141GREEN2.32s after repair,
`/tmp/rifty-316-i7-diagnostic-restored-green.log`. Original gate log:
`/tmp/rifty-316-i7-pr-check.log`.

Independent ADR-0391 artifact review accepted SHA-only TypeScript worker pin
cddf156d671c4b39abeae202b84cd907b6d936974e9537481da6a30773b07e58,
10022664bytes unchanged.540inputs/40output bijection, unchanged edges;47bytes
only6hash references. TS/compiler/WASM/lexer/generated-client contents remain.
All43packed assets equal generated/installed/public/served copies. Keep2MB limit
and every other exception. Actual updated asset gate GREEN; details and
executed provenance: workbench-operation-budgets-assets.md.

## Composed packed goal proof

`node tests/integration/workbench-packed-consumer.mjs --keep` GREEN;
`/tmp/rifty-316-i7-packed-green-kept.log`, SHA256
bf8555365606e6841c518673a99ab2975f48e8e48570b2c35515f0d4d81e03ea.
Kept consumer: rifty-workbench-packed-consumer-FzKlRF/consumer under system tmp.
15first-party+83external tarballs; actual installed public typecheck/build,
producer tar.gz/raw HTTP-decoded restore, real Node policy output, registry and
snapshot-only Vite build/dev/HMR/sqlite, namespace former-root reopen, saved-state/
apply and retained-Scratch recovery. Scoped /sandbox/p/5173 uses copied staticSW,
actual assets/API/CSS/dynamic module/HMR sentinel, native SW stop/restart+host
reload, unchanged outside host and zero registry/Eddy egress.

Scoped public B90/F95/T100/S105/P30 seconds additionally drives actual catalog,
versioned file write+durability, SCM and archive exact decoded bytes. Effective
long/short/failure behavior is separately discriminated by56unit+8native cases;
normal-speed packed success alone does not prove timing. Existing default/root
and strict saved-state journeys retained unchanged.

## Final source checks

After preserving the old diagnostic, the current separate overflow guard was
reverted alone:10semanticRED; exact current file restored, then141/141GREEN.
`/tmp/rifty-316-i7-final-overflow-revert.{py,json}` and `-final-core-green.log`.

`RIFTY_PLAYGROUND_PORT=5496 pnpm test:e2e:prod`:7/7GREEN3.3min,
`/tmp/rifty-316-i7-app-prod.log`. Actual generated App, Buffer realm, owner
startup, complete nodemon journey38.3s, Hono/Koa, TypeScript F12/dependency
Problems and webpack cold install/HMR/reload. Expected unavailable-route503s
visible; no pageerror in this run. Historical I5 question remains a NOTE.

Final source666b2687bff3d78147beac85319a898791872a4d: fullprcheck25/25,
unit195.3s/parity61.5s. IndependentFinal32/32 verifies I7 AND allacceptedI1–I8;
141unit+8native+175controls PASS/1existing skip, no required residuals.
Exact binding: workbench-operation-budgets-final-green.json.
