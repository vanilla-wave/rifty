---
area: service-worker
status: draft
title: ADR-0125 §2 promises a multi-window anonymous-embedded heuristic warn in owner-resolver.ts that does not distinctly exist
created: 2026-06-13
why: ADR-0125 §2's 'honest residual' promises an observable warn-once for the multi-window anonymous-embedded ('') routing heuristic, but the sole warn is the generic no-clientId fallback and the code path that actually applies the ready-window heuristic emits no warn — so the documented operator diagnostic is misleading.
user_story: As a developer with two preview windows open whose `''` anonymous-embedded fetch lands on the wrong one, I want a console warn naming the most-recently-focused-ready-window heuristic so I know which window served me, but today only the generic `no clientId; falling back to first controlled window` warn fires and mislabels the case.
sources: [ADR-0125]
code: [packages/service-worker/src/owner-resolver.ts, packages/service-worker/src/owner-binding-window.ts]
---

## Context

For the '' anonymous-embedded sentinel: '' is falsy, so FirstWindowOwnerResolver takes the `if (clientId)` false branch and fires the generic warn 'preview fetch had no clientId; falling back to first controlled window', then returns all[0]. The ready-window preference the ADR describes ('most-recently-focused ready window via clients.matchAll order') is applied in owner-binding-window.ts:55-82, which emits NO warn. So the generic message names neither the ready-window preference nor the focus-order heuristic and mislabels the '' case as 'no clientId'. Note: the ready-window logic lives in the binding, not owner-resolver.ts as the ADR implies. The nearby security + foreign-tab concerns (window-owner ready-frame auth, foreign-tab 503/COEP) were closed by ADR-0160 and are distinct from this warn-message gap.

## Options or Next

Pick one (behavior-preserving): (1) emit a distinct warn-once naming the most-recently-focused-ready-window fallback at the actual decision point in owner-binding-window.ts resolveOwner, so the diagnostic matches the ADR; (2) correct ADR-0125 §2 + the Consequences 'heuristic' note to state the residual is covered only by the generic no-clientId warn, with no heuristic-specific diagnostic. Add a regression test asserting the warn text/site matches the chosen wording.

## Reversibility

REVERSIBLE — backlog item; diagnostic text / ADR wording alignment, no public API or routing-contract change (SW_ROUTING_VERSION unaffected).
