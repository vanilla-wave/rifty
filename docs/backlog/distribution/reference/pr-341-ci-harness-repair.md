# PR341 — preserve CI checks across real input growth

BASE5c0016ae5. CI38330144084/unit115077937055:oldest real report CLI test
exceeds default5s although its child already admits30s; archive-wide JSON
validation exceeds60s. Actual isolated baseline17PASS38s, no assertion failure.
983gzip inputs:344.5MB compressed/18.50GB decoded; largest433.5MB decoded.
Fix test grouping:each gzip and each manifest keeps existing60s admission;
all old JSON/header/size/SHA assertions and frozen-bundle exception retained.
Global nonempty gzip/manifest guards remain. Legacy outer test35s admits its
existing30s child plus fixture/readback; command timeout and assertions unchanged.
Actual changed unit suite1182PASS; no report/source artifact rewritten.
Full `pnpm pr:check --all`:27PASS, unit193.6s/parity114.5s, no retries.
Real copied-cohort faults:wrongOS,invalidJSON,wrongbundleSHA reject; control
and exact restored input pass. No mocked artifact checker or skipped large file.

CI no-coi115077937136:canonical program transforms2980 rather than stale2180.
Real local unchanged testRED. Diagnostic currentCOI/noCOI binaries equal; both
installed-version maps match. NativeNode24.16/npm11.17 build2195, so replacing
literal with2980 would not establish a native oracle. Actual lock comparison:
Node reuses rooticons2.22.0; bothRifty add uikit-nestedicons2.22.1. Visible ordinary
npm override holds this fixture's transitive icons to its existing root pin.
Both realRifty paths restore original2180; all original module-count/byte/marker/
capability/recipe assertions stay unchanged. Actual Node override install/build
passes and preserves2195. Shared perf scenario/identity and product code unchanged.
General ordinary placement gap captured, not repaired, in
`docs/backlog/npm-client/compatible-root-transitive-reuse.md`; owner/trigger explicit.

## Fault matrix

| axis × operation | required result | proof |
|---|---|---|
| frozen-assumption × CLI admission | test admits existing bounded real child + readback | captured CIRED/isolatedPASS/current35s; child30s unchanged |
| frozen-assumption × growing archive verification | every original file/manifest remains checked | same enumeration/983gzip/fullchecks; copied faults RED |
| frozen-assumption × fresh dependency resolution | fixed workload does not silently acquire nested newer icons | real locks/Node/current RED/visible override; all original parity assertions GREEN |

External registry504/YC PermissionDenied remains a separate hosting blocker;
this source acceptance does not declare remoteCI green or change smoke gates.
