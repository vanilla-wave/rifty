# ADR 0292: Workbench authorities replace Solid orchestration core

Status: Accepted
Date: 2026-07
Supersedes: ADR-0197

> TL;DR: framework-free Workbench authorities own executable lifecycle;
> Solid owns presentation policy over their semantic handles, so the old
> `orchestration/*` core and consumer-defined lifecycle ports are retired.

## Context

ADR-0197 extracted browser-coupled `App.tsx` behavior into node-testable Solid
modules. Before a framework-free consumer existed, it deliberately accepted
page-owned coordination, fake-port drift, and a later signals-to-observables
rewrite.

That gate is met. ADR-0263/0278/0282 define a framework-free Workbench and
finite Playground companion. They keep the owner, mutation ordering, project
roots, terminals, previews, catalog, and teardown behind semantic handles.
The migration removes the boot/switch/run/save/SCM/terminal orchestration
modules; the App adapter now serializes product UI intents over those handles.

Retaining the Solid core would restore a second authority that correlates
sessions, runs, writes, previews, and teardown above the real Workbench owner.
The residual editor queue schedules presentation readiness; its directory name
does not grant lifecycle ownership.

## Decision

1. Workbench and its Playground companion own project/session/run, file and
   document mutation, terminal, preview, catalog, health, durability, and
   teardown semantics. The page does not reconstruct them from frames, roots,
   guest output, request ids, or parallel state machines.
2. Solid owns presentation policy only: selection, dialogs, layout, toasts,
   Monaco/xterm binding, and serialized user intent. Adapters consume public
   semantic handles; they do not mirror Workbench resource state.
3. Retire the required `apps/playground/src/orchestration/*` Solid core, its
   consumer-defined lifecycle ports, and its architecture rule. App-local
   helper location is reversible and conveys no authority.
4. Test at the owner: Workbench contracts prove state, ordering, failure, and
   close behavior; adapter tests prove product policy; browser differential and
   e2e tests prove the composed page-owner-SW fabric.

Keeping the Solid core as a compatibility layer was rejected: it duplicates
ownership and correlation. Moving Solid into Workbench was rejected by
ADR-0003 and would exclude headless consumers. Exporting controllers or raw
ports was rejected by ADR-0263: topology is not semantic capability.

## Consequences

- Workbench behavior remains independent of Solid, Monaco, xterm, components,
  and bundler syntax; package extraction stays mechanical.
- Behavioral tests follow the state owner; presentation tests cannot substitute
  fake protocols or source assertions for browser acceptance.
- A new page-side project/session/run/write/preview state machine is an
  authority split, not an adapter convenience.
