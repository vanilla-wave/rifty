---
area: net
status: active
title: Table-driven RFC6455 frame-edge parity suite (Autobahn-style) for the upgrade sockets
created: 2026-06-18
why: the frame parser/encoder branches exist and are honest-by-construction (loud Close 1002/1007), but only ~a handful of happy paths are tested, so the compat "✅ tested RFC6455" claim leans on thin coverage
sources: [PR#42 ws-honesty-audit ws-frame-protocol-untested]
---
## Context
`upgrade-socket.ts` parseFrame/parseClosePayload reject malformed frames loudly (Close 1002/1007), but the test suite covers only close-code egress, a server Close-echo, one happy continuation, one masked-reject, plus the 126/127 length round-trips and concurrency added in this follow-up. Untested edges: RSV bits set → 1002; client→server unmasked → reject; invalid UTF-8 text/close-reason → 1007; invalid/reserved received close code → 1002; 1-byte close payload → 1002; control frame >125 bytes; fragmented control frame; data frame mid-fragment. `docs/public/compat/http.md` advertises ✅ "tested RFC6455" on this thin base.

## Options / Next
Add a table-driven parseFrame/parseClosePayload suite covering each rejection branch, plus a real-`ws` Autobahn-style interop pass (size classes, UTF-8, close codes). Mutation-check each guard.

## Reversibility
REVERSIBLE — test-only.
