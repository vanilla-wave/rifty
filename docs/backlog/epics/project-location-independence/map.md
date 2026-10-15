# Map — project-location-independence

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `distribution/home-project-default-and-project-owned-tmp-home` —
   **home-project** — I1, I2, I4; the public root parameter
   (`publicProjectRoot`, Workbench option) with default `/home/project`,
   project-owned `/tmp`/`/home/rifty`, second-location and `/` lanes; merged
   the former `public-project-root-parameter` item (re-cut 2026-10-16);
   ADR-0531 supersedes ADR-0280's Decision + ADR-0278 §Corrections.
2. `npm-client/vite-root-policies-removal-node-exact-at-root` —
   **node-exact-at-root** — I3; after 2; deletes `viteRootWatchPatchPolicy` /
   `viteRootUrlPatchPolicy` and their validation, installed-bytes identity
   test, and — compiled only after item 2's ADR fixes the `/tmp`/`$HOME`
   form at root `/` — a `/`-rooted Vite 7.3.6 lane asserting real Node's behavior at
   `/` from the evidence §Root artifacts (their configs pinned as the
   oracle); removes ADR-0433 (+ README pointer); updates the ADR-0384
   inventory rows. Vite 8 at `/`: byte identity only until a real-Node
   artifact exists.

## Open questions

- Which private prefix carries the project-owned `/tmp` and `/home/rifty`
  (the reserved `/.rifty` of ADR-0280, already excluded from archives by
  ADR-0278, or a sibling directory beside the project tree)? — owner: agent —
  decided in the ADR at pickup of item 2.
- What does the synthetic `/` list when the root is non-root (`home`, `tmp`;
  `/dev/null`? `/usr`, `/etc`?) — owner: agent — decided at pickup of item 1
  (the parameter needs it), refined at item 2 by probing real Node programs
  that stat system paths.
- Exact loud form when a `/`-rooted project tree carries its own `tmp/` or
  `home/` under the mounted areas — owner: agent — item 2's ADR; item 3's
  `/`-rooted lane depends on it.
- Real-Node artifact for Vite 8 at `/` (Rolldown bundle) — owner: agent —
  container probe at pickup of item 3; until then I3's Vite 8 clause is byte
  identity only.
- Which of the ~120 `=== '/'` prod sites (grep over packages/apps/tools
  excluding tests/dist) mean "root-as-project", and does SW preview routing
  (handoff §B) depend on the public root? — owner: agent — mechanism sweep at
  pickup of item 1 (`fault-classes.md` §Class-kill).
- Does any starter/template or baked snapshot embed the public root
  (`install-stamp` is root-relative; `.bin` shims are relative)? — owner:
  agent — grep + snapshot re-bake at pickup of item 2.
- Form of the parameter (Workbench/SDK option, template field)? — owner:
  agent — item 1 ADR; never a playground UI (goal §Decisions).

## Out of scope

- A namespace showing all projects at once — rejected route (goal §Decisions).
- Shared persistent `$HOME` across projects — rejected route.
- Namespace isolation between projects and switch-by-respawn — ADR-0280/0165
  unchanged.
- Repairing Vite's behavior at `/` — I3 documents it as real Node's.
- Classifying the Vite root policies — `honest-guest-package-adaptations` I3
  (their kill condition is this goal).
- Vite 7.3.7 / proven-version policy — separate refine.
