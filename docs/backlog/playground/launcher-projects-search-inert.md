---
area: playground
status: draft
title: Launcher Projects tab search field is inert
created: 2026-08-07
why: The shared launcher search input flips its placeholder to "Search projects" on the Projects tab, but ProjectsTab receives no `q` and filters nothing — the field promises a capability that does not exist
user_story: As a user with many saved projects, I want to type in the launcher's "Search projects" field and see the project grid narrow to matches, but today typing changes nothing on the Projects tab
sources: [preset-open-scenario audit 2026-08-07 (loader-placement fix PR); dedup no-match — outcome-oriented-launcher reworks launcher IA but does not cover Projects filtering, no other item names ProjectsTab]
code: [apps/playground/src/components/Launcher.tsx, apps/playground/src/components/ProjectsTab.tsx]
---

## Context

`Launcher.tsx` passes `q` only to `StartersTab` (which filters by it); the
Projects tab renders the same header input with a "Search projects" placeholder
while `ProjectsTab` has no `q` prop and no filtering. Observable lie: an
affordance that does nothing. Forks to settle before ready: match fields
(name only vs name+starter), scratch-banner visibility under a query, filtered
vs total count in the `SAVED PROJECTS · N` label, empty-match state.
