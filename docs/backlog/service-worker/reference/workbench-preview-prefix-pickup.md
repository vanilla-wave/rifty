# I5 pickup — executed native scope/configuration research

Historical probes precede ADR-0409; its selected decisions own implementation.
# PR316 / I5 — immutable preview-prefix configuration pickup

Read-only tracked tree. 2026-09-09, inspected HEAD
`12893651c1c0528462cfd898d35fec5362cfe16e`.
Continuation of `/tmp/rifty-316-preview-prefix-pickup.md`; goal scenario 3/I5
and `docs/backlog/service-worker/workbench-preview-prefix.md` are authorities.
No new user fork: route spelling/carrier are agent-owned.

## Result

Choose one immutable optional preview pathname prefix, delivered to the copied
static SW through its registration script URL query. The SW reads its own URL
once at realm startup. Prove the actual controller's prefix on the EXISTING
transferred-port PONG. Native Chromium verified query persistence across real
SW termination/restart and host reload; the current PONG matcher accepts a
wrong-prefix old controller and therefore needs the extra equality check.

No mutable prefix map, config replay, new handshake, timer, or coordinator.
No custom host Worker/SW bundling. No new root-navigation promise.

## Executed native probe

Reproducer: `/tmp/rifty-316-preview-prefix-configuration-probe.mjs`.
Output: `/tmp/rifty-316-preview-prefix-configuration-probe.json` and `.log`.

```text
node /tmp/rifty-316-preview-prefix-configuration-probe.mjs \
  > /tmp/rifty-316-preview-prefix-configuration-probe.log 2>&1

Node 24.16.0; Chromium 148.0.7778.96; all assertions passed.
```

Only localhost/native browser effects and `/tmp` output. No main build, dist
write, tracked source/test edit, unit/full gate or packed-host run.

The probe transpiles the exact current `service-worker-control.ts` into a
scratch browser module, using constants read from current `protocol.ts`.
It also serves current `control-ping.ts` with experimental PONG prefix/realm-ID
fields. A second scratch proof variant changes ONLY the existing PONG matcher
to require the expected prefix. The native SW is a small carrier oracle, not
the rifty runtime/preview implementation. Raw source SHA256 values are in JSON.

Measured sequence:

1. Native SW `/sandbox/sw.js?<opaque query>`, scope `/sandbox/`, with no new
   option/query field. Captured prefix defaults `/preview/`. Current proof and
   candidate default-prefix proof both pass under this narrow scope.
2. Register replacement SW URL with appended selected `/sandbox/preview-a/`.
   Hold replacement installation at a real fetch boundary. Old controller
   remains active, with current frame/routing versions but default prefix.
   Actual current Workbench proof **accepts** it. Prefix-aware variant waits
   and fails at the existing proof deadline; no matching prefix was proven.
3. Start a pending prefix-aware proof; release install gate. Existing
   `controllerchange` handling follows the new controller and accepts its
   matching PONG. No new update/retry mechanism needed.
4. `ServiceWorker.stopWorker` through native CDP; observe `runningStatus:
   stopped`. Next PING restarts the SW. New global UUID proves a new realm;
   script URL, prefix and routed preview response stay identical.
5. Reload the host, without re-registering. Same query/prefix, matching PONG,
   and preview response. Unrelated scoped host path still returns host bytes.

Actual excerpt (ephemeral origin omitted):

```json
{
  "queryBytesPreserved": true,
  "staleDuringInstall": {
    "currentProof": "accepted",
    "candidateProof": "Service-worker control proof timed out waiting for PONG"
  },
  "pendingProofFollowedControllerChange": true,
  "nativeStopObserved": true,
  "beforeStopBoot": "5d2d26e2-a0c1-48cc-8001-048b9d06c678",
  "afterStopBoot": "a9a6190c-22a7-497e-bddb-5302cf417055",
  "prefixBeforeAfterReload": "/sandbox/preview-a/",
  "unrelatedHost": "host-static"
}
```

Opaque query sent/observed unchanged by both browser and server:

```text
token=a%20b~c&dup=one&dup=two&blank=&bare&encoded=%2f%2F
```

Using URLSearchParams.append would instead rewrite it to:

```text
token=a+b%7Ec&dup=one&dup=two&blank=&bare=&encoded=%2F%2F
```

That rewrite was asserted in the probe. Do not mutate searchParams on the
caller URL. Read-only searchParams inspection is safe.

## Minimal API and normalization proposal

Public additive field: `WorkbenchOptions.deployment.previewPrefix?: string`,
inherited by PlaygroundWorkbenchOptions. Example `/sandbox/preview/`.

- A pathname prefix, not an origin/URL/query/fragment and not existing
  `previewScope` (run identity). Require one leading `/`; reject `//`, `\\`,
  query, fragment, encoded slash/backslash. Canonicalize URL pathname once;
  append final `/` if missing. Normalization resolves dot segments before
  scope containment, so `/sandbox/../preview/` cannot bypass the scope check.
  Preserve existing port admission behavior; this unit does not redefine
  digit/port validity.
- The ONE public validator remains
  `workbench/internal/workbench-options.ts`. It owns origin/scope checks before
  lease, SW registration, Worker creation or storage effects. Explicit prefix
  must produce same-origin preview routes under the supplied SW scope.
- **Absence is distinct from explicit default.** When absent, retain default
  `/preview/`, leave normalized caller SW URL unchanged, and DO NOT add an
  unconditional default-prefix-in-scope check. Existing narrow-scope owner/
  Node-CLI configurations without preview are valid; rejecting them is a
  regression. An explicitly selected `/preview/` outside `/sandbox/` does
  reject. Do not silently select `/sandbox/preview/` on the caller's behalf.
- Absence/default is still the expected config in PONG. This proves controller
  identity/config without claiming that root preview navigation works under
  the narrow scope. Existing root deployments retain the old route.
- Normalize/freeze the prefix once in owner start input; carry it in existing
  exact owner boot config to existing preview registry URL writers. Parameterize
  generic Node/dev/production-preview entries, not only first Vite output.

## Static SW URL carrier

Suggested reserved key: `__rifty_preview_prefix`. Its spelling is agent-owned.
Key/carrier writer/reader belong together in the service-worker package;
canonical pathname semantics remain in io. Workbench consumes the package's
public helper; no duplicated ad-hoc query parser in Workbench/SW.

Only explicit option adds one encoded key/value to the ALREADY VALIDATED URL:

```text
.../sw.js?<original query>&__rifty_preview_prefix=%2Fsandbox%2Fpreview%2F
```

Preserve the original validated URL as a byte prefix. Choose `?` if it has no
query delimiter, otherwise `&`; this also preserves bare `?`, trailing `&`,
duplicate opaque keys, empty/bare values and percent-escape spelling. Existing
fragment stripping belongs to current URL validation, unchanged.

On explicit option, read-only inspect for a pre-existing reserved key and
reject collision instead of replacing it or choosing a last value. On SW load,
absent key means `/preview/`; duplicate/invalid configuration is a loud install
failure, never a fallback to another prefix. Document this new reserved key.
No rewriting/default query insertion when the option is absent. PONG expected
default also prevents a preconfigured nondefault controller from silently
changing absent-option Workbench routing.

The native probe proves the browser uses query as script-URL identity and
retains it at `self.location.href` on restart. It proves the localhost static
server can serve the same bytes for both URLs; deployment documentation must
state that the host serves the copied SW asset with its query intact. No claim
about an arbitrary private host/CDN configuration was measured.

Alternative mutable ready/config handshake rejected: SW can restart without
page config replay; direct preview navigation needs its parser before owner
resolution. A per-owner config map adds replay/lifecycle/conflict questions
that immutable registration configuration avoids. Existing ready owner maps
remain solely owner/port readiness, never route configuration authority.

## PONG and version compatibility

Current owners:

- `service-worker/src/control-ping.ts`: one transferred reply-port handler.
- `workbench/service-worker-control.ts:102,114,153`: exact current-controller
  identity and version check, active-attempt cleanup, existing deadline and
  controllerchange rebinding. Reuse all of it.
- `open-workbench.ts:193` initial control proof AND
  `workbench-browser-owner.ts:668` preview-route proof need expected prefix.
- `service-worker/src/sw.ts`: capture prefix once, pass SAME value to control
  PONG and preview interceptor. PONG must report actual captured configuration,
  never echo a page-requested prefix that has not been installed.

Suggested frame change: `SwPongFrame.previewPrefix?: string`, documented
default `/preview/`; producer can always send its normalized value. Consumer
uses absent default and requires equality with normalized expected prefix,
in addition to current type/from/frame/routing/controller/port conditions.
PING needs no new field: receiver reports truth, requester compares it. Wrong
prefix uses existing wait-for-correct-PONG/controllerchange/deadline path;
adding a diagnostic is optional, adding another timer/map is unnecessary.

Current `SW_FRAME_VERSION='1'`, `SW_ROUTING_VERSION='6'` (protocol.ts:35,79).
ADR-0031/0040 explicitly permit additive optional defaulted fields without a
frame-version bump: frame version can remain 1. New addressing scheme requires
routing bump to 7. Old routing-6 peers fail current mismatch admission; never
let version equality alone stand in for prefix equality. Document regeneration
of the published copied asset set; no old/new mixed-asset guarantee is created.

## Minimal net/HTML injection carrier

No need to thread prefix through every guest bootstrap or widen SW HTTP request
payload. The existing page-side bridge already captures deployment and sends
the net request envelope:

```text
workbench-browser-owner mount
  -> glue/preview-port-wiring.ts: wirePreviewBridge(..., prefix)
  -> net bridgeCrossRealmPreview(port, {scope, previewPrefix})
  -> existing PreviewPortFrame type:'request', optional previewPrefix
  -> serveCrossRealmPreview -> injectPreviewWebSocketBridge(html, prefix)
  -> webSocketBridgeClientScript({previewPortFromPath:true, previewPrefix})
```

Keep `scope` unchanged: it is the child/run discriminator. Prefix belongs only
to page-preview request metadata, never guest Request headers, guest URL path,
environment, HMR configuration or dispatch function signature. Capturing it
in bridgeCrossRealmPreview automatically covers Request and dispatchStruct
paths (`preview-port.ts:809,837,847`). Thus `SerializedRequest` on the SW hop
and `PreviewDispatchStruct` need no added field. Omitted field defaults the old
prefix for legacy direct/no-COI callers and live internal request senders.

`PreviewPortFrame` version currently 2, with an explicitly additive-compatible
policy (`preview-port.ts:39`). Optional defaulted request metadata can retain
version 2. Do not promise that an old net worker can honor a new nondefault
prefix: published asset closure is one compatible set; routing proof only
certifies SW/page config. If mixed net versions must become a promise, that is
separate evidence/negotiation work, not an invented implicit guarantee.

For generated WS JS, use io's canonical prefix/port pattern builder as source
for an embedded RegExp, instead of maintaining another root-only literal.
Use the same normalized prefix when stripping document-relative WS URLs.
Root-relative guest paths stay literal; external WS stays native. Existing
`PREVIEW_PREFIX_RE` remains the default compatibility export; parameterized
parse/build helpers own custom addressing. Remove the trivial single cached
script tag or key it only if measured need appears; no new cache authority.

Existing HTML response codec, header/length correction, encoding failures and
idempotence marker remain authoritative. Nothing justifies another rewriter.

## Required Contract+RED / final reach

- Absent option leaves full opaque SW URL unchanged and narrow non-preview
  owner boot valid; explicit out-of-scope prefix rejects before effects.
- Raw URL query append preserves encoding/duplicates/bare values and rejects
  reserved collision; SW reader and public writer round-trip same normalized
  prefix, with duplicate/invalid input loud.
- Same-version stale-controller wrong-prefix PONG cannot admit startup;
  correct replacement controller can satisfy the EXISTING pending proof.
- SW termination/reload restores prefix from script URL; no replay traffic.
- All registry writers use selected prefix; SW direct path and referrer
  recovery share parser; anti-hijack/owner selection still discriminate.
- Existing net request paths deliver prefix to generic injected WS script;
  relative WS strips complete prefix; root-relative and external URLs retain
  their respective guest/native semantics.
- Parent owns real packed host under `/sandbox/`, copied static assets,
  namespace/no-registry, real Vite HTTP assets + HMR and unrelated host bytes.
  This native configuration probe does not close that product acceptance.

Earlier native probe already settled the HTTP boundary: a controlled iframe's
root-absolute subresources can be intercepted outside script scope; an
out-of-scope NEW document navigation cannot. Initial selected preview URL is
in scope. Do not add root-navigation/redirect rewriting or root SW scope to
hide that native boundary.

# I5 preview-prefix pickup research

Read-only research against I3 preparation98773a29f; no tracked edits. Parent
continues I3. No I5 contract/interface frozen. Only this scratch report written.

## Authority

- Goal: docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, scenario3/I5.
  Host page /sandbox/, preview in that same non-root SW scope; real Vite
  edit/build/dev/assets/HMR; unrelated host routes untouched; unchanged guest
  source URLs. Existing root default preserved.
- Draft: docs/backlog/service-worker/workbench-preview-prefix.md. Already
  settles observable scope; carrier/API spellings are agent choices. Invalid or
  out-of-scope configuration rejects before deployment effects. Existing
  response/owner authorization stays. Scope is not JS security isolation.
- Captured user-source record: docs/backlog/distribution/reference/embedder-gaps-evidence.md
  lines1-18,75-104: in-session review of Tracker report, selection3,6,7,4,8,5,10.
  Repo searches located this accepted summary and goal decision history, not a
  separate verbatim raw-answer transcript. Do not quote the summary as a raw
  user answer. Current goal + parent's explicit unchanged-source instruction
  settle I5; no user fork is needed to pick the existing route carrier.

## Important native-browser fact — measured

Chromium148.0.7778.96, Playwright installed in this checkout. An inline Node
loopback server served a minimal native SW at /sandbox/sw.js with scope
/sandbox/. A host at /sandbox/host.html registered/controlled it and opened
/sandbox/p/5173/ in an iframe. SW remembered resultingClientId for that document.
The guest HTML had an unchanged absolute module src="/src/main.js"; that module
used unchanged fetch('/api/value'). Both reached the SW with the iframe clientId
although their URL path was outside /sandbox/. They did not hit the network.
The host page and an uncontrolled /outside.html fetched the same /api/value
from the real host. No project-source or asset-URL rewrite is required for this
HTTP subresource path: SW scope selects controlled clients, not every URL they
can subsequently fetch.

Actual output:

```json
{
  "browser": "148.0.7778.96",
  "resourceProof": "guest-root-fetch",
  "parentProof": "host-static",
  "outsideProof": {"controller": false, "body": "host-static"},
  "navigationProof": {
    "url": "http://127.0.0.1:63528/next",
    "body": "host-next",
    "controller": false
  },
  "networkRequests": [
    "/sandbox/host.html", "/sandbox/sw.js", "/api/value",
    "/outside.html", "/api/value", "/next"
  ]
}
```

SW event trace: /sandbox/p/5173/ navigation(destination iframe, empty clientId,
new resultingClientId); /src/main.js(script) and /api/value(fetch) with exactly
that remembered clientId; parent's /api/value with a different unrecognized
clientId. NO event for /next.

Boundary, not a new promise/fork: iframe location.assign('/next') is a new
out-of-scope document navigation. It goes to the real host /next and loses its
controller. A narrow SW cannot catch this just because the previous document
was controlled. Do not silently promise all root navigations/redirects under
I5, widen to root scope, or add a generic project/HTML rewrite to hide this.
The required initial iframe navigation is the configured in-scope preview URL.
History/reload/root-navigation behavior must be described honestly if discussed.
This is an isolated browser-semantics oracle, not proof that configurable rifty
preview already exists.

Reproduction algorithm executed via `node --input-type=module` heredoc:
1. node:http server on random127.0.0.1 port, routes above; no filesystem assets.
2. native SW install skipWaiting/activate clients.claim; fetch listener records
   request path/clientId/resultingClientId/mode/destination; recognizes only
   /sandbox/p/5173/ nav and remembers resultingClientId.
3. recognized iframe /src/main.js response executes root /api/value fetch;
   recognized iframe /api/value returns guest-root-fetch; other requests fall
   through. /sandbox/events returns recorded events to the host.
4. chromium.launch({headless:true}), fresh context; register scope/sync on
   controllerchange; append iframe; assert its #app text; compare host/outside
   fetches. Set iframe location.assign('/next'), read body/controller, then read
   SW events. Close context/browser/server. No checkout writes.

## Current source owners and defaults

| Boundary | Actual owner/evidence | Required consequence |
|---|---|---|
| canonical address | packages/io/src/preview-protocol.ts:22,54 | PREVIEW_PREFIX_RE /^\/preview\/(\d+)(\/.*)?$/, parse returns port/rest; bare route rest '/'. Default remains /preview/<port>/. Parameterize shared parsing/formatting; no second consumer regex |
| guest HTTP URL | same file:43; packages/service-worker/src/route-preview.ts:97-108 | http://localhost:<port><guest-path> + original search. Keep localhost Host and request query/body semantics; host routing prefix never reaches guest path |
| public ingress | packages/workbench/src/workbench/internal/workbench-options.ts:23,133-153,250 | one WorkbenchOptions validator. SW URL/scope resolved once against document.baseURI, same-origin HTTP(S), fragments stripped, encoded path separators rejected; client URL must start with scope. No preview-prefix option today |
| before effects | packages/workbench/src/workbench/open-workbench.ts:~150,190 | validate before page claim; initialization takes origin lease, registers SW, proves controller/PONG, then starts owner. Prefix/scope invalidity belongs before these effects |
| compiled SW entry | packages/service-worker/src/sw.ts:installPreviewInterceptor(self) | static copied entry has no runtime routing configuration today; no custom host Worker/SW build is allowed by I2 |
| document/fetch match | packages/service-worker/src/preview-bridge.ts:109,150,279-350 | matchPreviewUrl delegates io; same configured parser must drive direct URLs AND same-origin referrer recovery |
| root-absolute resources | same file:~305-349 | remembered iframe clientId->port, else known preview referrer recovery. This already routes /src/main.js, /@vite/client, CSS/assets/chunks and fetch('/api') without changing source. Unknown page traffic returns without respondWith |
| preview anti-hijack | same file:233-270; owner bindings | SW-served preview document IDs excluded from ready owners; separate live-client set from capped frame-context map. Do not replace with URL-string trust |
| actual owner selection | owner-binding-port-aware.ts + owner-binding-window.ts + owner-binding-worker.ts | preserve window ownerToken + port selection, worker preference, copied-top-level unique-owner behavior, ambiguous503 |
| URL producer | packages/workbench/src/workers/preview-registry.ts:155,187,214,247 | four /preview/${port}/ writers: derived dev frame, dev entry, production-preview entry, generic Node entry. One createPreviewRegistry factory in workbench-project-runtime.ts:168 can carry normalized routing data; do not fix only Vite's first URL |
| browser projection | packages/workbench/src/workbench/workbench-browser-owner.ts:635-655 | onPreview copies entry.url into PreviewAdvertisement. Routes mount by port/ownerToken/previewScope; registry publishes the same URL |
| public readiness | workbench/preview-readiness.ts:225-232; workbench-browser-owner.ts:851-869 | fetch advertised URL with cache:no-store, accept response.ok, return {port,url}; no hardcoded path. Public preview registry, selectors and PreviewPanel mostly consume entry.url already |
| page mount | workbench/glue/preview-port-wiring.ts:wirePreviewBridge; preview-bridge-wiring.ts | mount net bridge + registerPort; advertise ownerToken/ports; teardown all hops. previewScope is existing run identity, NOT an HTTP prefix |
| legacy sibling | packages/rifty/src/sandbox.ts:295,479,559 | independent /preview/${port}/ for no-COI Sandbox. Goal excludes no-COI changes; preserve default. Do not silently expand public Sandbox configuration in I5 |

Existing service-worker standalone registerServiceWorker helper defaults scope
'/' (register.ts:~42). Workbench does not call that helper: browser composition
uses navigator.serviceWorker.register directly with the validated supplied
scope (open-workbench.ts:190, browser-workbench-composition.ts:35-44).

The current parser accepts decimal digit strings without an explicit1..65535
check. Prefix work must not silently redefine unrelated existing port admission.

## WebSocket/HMR — separate critical sibling

SW does not intercept ws/wss. ADR0189's generic net bridge is required:

- packages/net/src/cross-realm/preview-port.ts:284,372-456 owns actual response
  injection for every text/html preview, not Vite-specific code. It strips
  accept-encoding before dispatch, bounds/drains HTML, handles charset and
  gzip/deflate, injects before scripts, adjusts headers/length; unsupported
  encodings remain loud. Preserve all these semantics.
- preview-html-inject.ts uses a cached one-size script tag generated with
  previewPortFromPath:true; marker data-rifty-ws-bridge preserves idempotence.
- ws/browser-client-script.ts:~75 has another hardcoded /^\/preview\/(\d+)/
  inside the generated self-contained JS; ~119 builds '/preview/'+guestPort
  to strip the browser prefix from document-relative/page-origin WS paths.
  This sibling already contradicts the aspirational single-parser comment in
  ADR0036. Prefix change must fix both guest-port extraction and path stripping
  through the canonical io authority (including generated-script delivery).
- Same-origin or loopback WS URLs map to the guest port discovery channel;
  external WS stays native. Preserve original path/query/subprotocol validation.
  Root-relative WS '/api/socket' is already a guest path; document-relative 'ws'
  resolves under the preview URL and needs only the full host prefix removed.
- Existing ws/browser-client-script.test.ts:~610,668 covers deep preview paths,
  page host/127.0.0.1 and relative-vs-root-relative path behavior. Extend same
  cases with non-root configured prefix; don't add Vite HMR configuration.
- HTTP bridge serve callers: workers/dev-server-boot.ts:113,
  dev-server-child-bootstrap.ts:121 (later listened ports),
  node-entry-bootstrap.ts:185 (terminal/generic servers), and no-coi-toolchain-worker.ts:144.
  A request-level routing value on the existing preview-port transport could
  avoid threading a host HTTP prefix through every guest bootstrap. No choice
  frozen; direct binding/legacy fallback must retain defaults.
- PreviewPortFrame.scope is a run discriminator; do not overload it with URL
  scope. PREVIEW_PORT_FRAME_VERSION2 pins net hop separately from SW versions.

Host-relative static copied assets are already built with assetUrl(name) =
new URL('./rifty/'+name, document.baseURI) in the packed consumer. They belong
to host clients and must keep falling through, even while preview guest requests
for a same-origin root path go to the guest by clientId.

## Smallest route candidates for pickup — not an interface commitment

1. One normalized prefix in the existing deployment validation, carried to the
   existing io parser/builder, owner URL producer and browser WS adaptation.
   Preserve default '/preview/'. Require resulting preview routes within the
   selected SW scope and same origin. Normalize URL references once; use one
   canonical trailing-separator/path-boundary representation, forbid query/
   fragment/encoded separators in a path prefix; prove collision/out-of-scope
   handling before register/start. Exact accepted spelling belongs in ADR.
2. Static SW must know the same immutable prefix before handling fetches. An
   internally produced SW script URL query is a small candidate: the copied
   file remains unchanged, scope registration remains independent, the worker
   can recover config from its own URL across termination. Existing URL
   validator allows query on SW script URLs. Avoid a new runtime route map.
   Need an actual probe of hosting/query and stale-controller transition before
   selecting; this research did NOT implement or certify that carrier.
3. Alternative: additive config in the existing ready/control handshake. It can
   reuse current peer state, but introduces replay/restart and per-owner routing
   selection before owner resolution. Reject a separate prefix registry or
   mutable last-writer global unless evidence forces it. Never let iframe ready
   frames choose routing config (anti-hijack).
4. For net HTML injection, carry the normalized address data over the existing
   request transport or immutable server setup, then supply it to the current
   client-script generator. Do not create another HTML rewriter or infer prefix
   from arbitrary path segments. Script cache currently assumes one default:
   prefer removing that trivial cache over a new multi-key route/cache layer.

A mere page URL projection plus SW regex edit is insufficient: WS script would
still use root-only parser/strip; stale SW could answer current-version PONG
while using another prefix. proveRiftyServiceWorkerControl presently proves
exact controller and frame/routing versions, not configuration identity. If
config is immutable per registration, ensure startup proves that actual
controller's config (or refuses/waits through update), not merely some current
rifty SW. Existing readiness status-only HTTP probe could otherwise accept host
fallback HTML200 at a wrongly routed path. This is a required discriminating
stale/config proof, not a new generic handshake coordinator.

## ADR / rule reconciliation

- ADR0036: io owns addressing; parameterized default-preserving successor, no
  new package or SW->net layering violation.
- ADR0040 + service-worker/protocol.ts: SW_ROUTING_VERSION currently6; addressing
  scheme changes require bump. SW_FRAME_VERSION remains1 unless chosen frame
  semantics actually need a major bump; optional additive/defaulted fields have
  existing exception. Net hop version is separate.
- ADR0097: extend direct parser/referrer recognition; retain frame context and
  unknown-host fall-through. No speculative clients.get for arbitrary host URLs.
- ADR0189: generic injected native WS bridge and preserved source URLs. Prefix
  changes its address extraction, not framework HMR policy/guest Host shape.
- ADR0263 Configuration: single early URL normalization and scope check. New
  deployment field/cross-package seam needs ADR, no user stop.
- ADR0278 preview registry/ownership and ADR0160/0123/0125 isolation: keep the
  existing registration/owner/route-operation authorities, copied-tab isolation,
  lifecycle settlement and port claims.
- Separate existing residuals: service-worker/preview-frame-context-lifecycle
  documents fixed-cap context eviction/referrer downgrade; fault-honest-sw-preview
  owns broader transport termination/403/reconnect work. I5 must not quietly
  promise to repair all of either epic; keep relevant real failure visible.

## Contract+RED / acceptance carrier

Unit tests alone do not close I5. The packed host must be built/served at
/sandbox/ with copied SW there, explicit scope /sandbox/, selected prefix e.g
/sandbox/preview/. Drop fixture-wide Service-Worker-Allowed:'/' (current
workbench-vite-consumer/vite.config.ts); if SW lives /sandbox/rifty/sw.js, grant
only /sandbox/ or copy it directly under /sandbox/. Do not mask narrow scope
with a root registration. Existing host build base needs /sandbox/ so host
bundle/static asset URLs are honest; guest package files remain unchanged.

Required proof paths:
- Default old root host stays green.
- Public run/preview registry advertises chosen prefix for dev, production
  preview and generic Node servers; readiness probes exactly that URL.
- Initial iframe navigation commits under prefix; actual Vite absolute
  /src/main.js and /@vite/client execute, CSS/image/imported chunk and
  fetch('/api/...') originate from the iframe and reach the guest.
- Native Vite HMR websocket opens from current-origin URL; edit module -> update
  event + changed DOM with sentinel preserved, no iframe reload. Existing packed
  harness already has this HMR sentinel/event proof; reuse it.
- Relative WS 'ws' strips entire configured prefix, root WS '/api/socket'
  preserves guest path/query, external WS remains native.
- Unrelated /outside/ host document remains uncontrolled; same root asset/API
  requested from host vs preview produces the correct distinct bytes. Host
  copied workers/WASM/static asset loads do not get captured by preview context.
- Reload actual controlled host/preview and configured SW startup with same
  config; stale/incompatible SW config fails control/admission honestly. Don't
  imply arbitrary out-of-scope navigation support from this case.
- Invalid/malformed/foreign/out-of-scope prefix causes zero SW registration,
  Worker starts and storage opens. Prefix separator boundaries matter.
- Preserve503 missing/ambiguous/not-ready owner and protocol mismatch; existing
  anti-hijack tests must still pass under chosen prefix.

Useful current suites: io/preview-protocol.test.ts; service-worker/tests/
preview-bridge.test.ts, preview-owner-binding-parity.test.ts, preview-handshake-*.test.ts,
register.test.ts; net/src/ws/browser-client-script.test.ts; workbench
preview-readiness/service-worker-control/playground-preview-registry contract
suites; real tests/e2e/preview-websocket-bridge.spec.ts and Vite HMR/preview
journeys; tests/integration/workbench-packed-consumer.mjs.

No I5 product gate run: feature/configuration absent. Native scope probe above
was executed. No tracked files changed by this research.
