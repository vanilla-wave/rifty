# Map — project-location-independence

Draft goal: no children seeded until the default-location answer.

## Items

(none — seeded at FIT)

## Open questions

- Which default public root ships (`/` as today, or a home-like path such as
  `/home/project`)? — owner: user — asked 2026-10-15 («не понял. Расскажи
  просто и понятно…»), explained, unanswered after the reframing; the goal
  stays `draft` until answered (`STOP-1a`).
- Which knob selects the root (Workbench/SDK option, template field)? —
  owner: agent — design at FIT after the default is chosen.
- What at `/` besides the project when the root is not `/` (`/tmp`, `/home`,
  `/dev/null`)? — owner: agent — design at FIT once the default is chosen.
- Which code paths assume root-as-project: 118 `=== '/'` prod sites, 7 public
  cwd literals, ADR-0278 archive root clause, e2e assertions on absolute
  paths, baked snapshots — owner: agent — sweep at FIT (mechanism sweep,
  `fault-classes.md` §Class-kill).

## Out of scope

- Classifying or removing the Vite root patches — `honest-guest-package-adaptations`
  I3 (they stay while `/` is a supported location).
- Namespace isolation between projects — ADR-0280 (decided).
- Vite 7.3.7 / proven-version policy — separate refine.
