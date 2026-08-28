---
area: distribution
status: draft
title: iframe embed tier — hosted rifty in someone else's page
created: 2026-07-10
why: the lowest-effort distribution tier (StackBlitz-embed-style) — a tutorial-site author drops an <iframe> + gets a live Node example; recorded per user call 2026-07-10, deliberately NOT in the embeddable-dev-loop epic
---

## Context

`<iframe src="https://rifty.dev/embed?...">` + postMessage control. Different persona than the SaaS own-UI epic: course/tutorial-site authors who won't install packages.

Hard platform constraint to design around: full stack needs `crossOriginIsolated`, and a cross-origin iframe can only get it when the TOP-LEVEL host page itself ships COOP/COEP **and** delegates `allow="cross-origin-isolated"` — identical to StackBlitz WebContainers embeds. So "drop into any page untouched" is impossible for the full runtime; honest shapes to refine later:

- (a) require the two host headers + allow attribute — still 100× cheaper than SDK hosting; doc-first.
- (b) no-COI degraded mode — against fidelity as a silent degrade; if ever, must be a loud capability gate (which features throw), not a quiet subset. Capability side captured: `distribution/no-coi-sandbox-tier` (2026-08-28).
- Also depends on: hosted embed route on rifty.dev, multi-instance/multi-tab story, postMessage API surface (files in, events out, preview sizing).

Refine when a real embedder (docs site / course platform) pulls it.
