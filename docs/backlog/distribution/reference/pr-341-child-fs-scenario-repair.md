# PR341 — share the bounded child-fs input

BASE9ed42ce68. CI38335379299/browser-unit115094308188:in-realm,
product and actual bench:child-fs CLI transform2980 instead of2180.
CI gate fails solely because that lane failed. All other sourceCI lanes,
including no-COI, passed. Same icons placement/input growth as prior harness
repair; that private no-COI helper omitted these siblings.

One source:canonical child-fs manifest now carries ordinary icons override to
its existing root2.22.0 pin. Both browser lanes, actual CLI and no-COI consume
it; private no-COI helper removed. Root dependencies/program bytes and all
original2180/marker/lifecycle/worker/dist checks retained.
Changed manifest has explicit scenario v2 and new scenario digest; dependency
digest unchanged. New artifacts use v2. Validator recognizes exact historical
v1/current scenario digests with the same exact dependency digest; historical
identity returned unchanged. Original perf artifacts and v1 Node golden kept.
No claims that old/new timings are comparable or graphs are identical to Node.
Full `pnpm pr:check --all`:27PASS, unit194.4s/parity112.4s, no retries.

Real baseline3browserFAIL; new identity unitRED. Original3browser tests plus
2real fault lanes5PASS; unchanged no-COI exactdist1PASS.
Unit20PASS; three real historical artifacts roundtrip byteexact. Four owning
reverts remove override/use old digest/rewrite history/drop dependency guard:
all RED on intended carriers; exact restored tree GREEN. Fresh native npm11/Node24 install,Vite7.3.6 build,
Express listen/close PASS; native2195 unchanged. General npm placement gap
remains the explicit draft compatible-root-transitive-reuse, not fixed here.

## Fault matrix

| axis × operation | expected | carrier |
|---|---|---|
| sibling-drift/frozen-assumption × fresh workload install | one visible ordinary manifest override, original2180 anchors | actual3browserRED→GREEN, no-COI exactdist |
| poisoned-cache/provenance-lie × changed input identity | new bytes emit v2 digest; v1 evidence unchanged | exact scenario hash, real historical artifacts, own reverts |
| corrupt-input × artifact identity | unknown scenario or changed dependency digest rejects | unchanged corruption checks and legacy-dependency guard |

Registry504/YC PermissionDenied remains independent; source proof cannot
close hosted smoke or declare remoteCI green.
