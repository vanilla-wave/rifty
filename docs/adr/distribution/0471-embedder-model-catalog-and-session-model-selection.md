# ADR 0471: Embedder model catalog and session model selection

Status: Accepted
Date: 2026-09-27

> TL;DR: native pi Models owns the embedder catalog and transport; sessions select a model id.

## Context

Goal `agent-weak-models` I1–I3 removes both 0.1.0 transport forms and requires
explicit model limits, switching with retained history and image input.
This supersedes ADR-0436 decisions 2–3; its other decisions remain active.
Independent DEC-2 decision: `catalog_decision`, pi 0.85.1 executable probes in
`docs/backlog/distribution/reference/ai-agent-model-catalog-evidence.md`.

## Decision

1. `createAgentSession({ models, model, modelOptions?, … })` takes native pi
   `Models`. `model` is a unique catalog id; missing/ambiguous ids throw.
   `modelOptions` maps ids to pi request defaults (reasoning, temperature,
   samplingParams). `Model.samplingParams` stays the native per-entry carrier.
   Limits come from each Model; no inferred context window.
2. Re-export pi catalog constructors/types. A thin `createOpenAIProvider`
   factory returns native `Provider` for the built-in fetch path, with explicit
   model context/output limits and optional reasoning=false/input=['text'].
   Custom transports use native `createProvider`/`setProvider`, including
   provider-owned StreamFn. No second session transport form.
3. `setModel(id)` preserves messages; the next assistant request uses that
   Model and defaults, including during a running tool turn. Emit a model
   event. Actual assistant identity remains the provider response's identity.
4. Trace config records effective selected Model and request defaults. Built-in provider keys and catalog
   headers are redacted from exported content; custom transports keep
   ADR-0436's responsibility for credentials/metadata they privately introduce.
5. Subsequent goal slices add `send(prompt, images?)`, retry/compaction options,
   recipe=false and context-exceeded. Mechanisms do not ship before I12's baseline; images may precede it.
   Images follow native ImageContent; binary input throws NotImplementedError.

## Alternatives

- Native Models + low-level Agent now: chosen. Existing tools, history and
  resource lifecycle remain; prepareNextTurnWithContext supplies the selected
  model because Agent's run configuration otherwise captures it.
- Native AgentHarness now: rejected for item 1; its retry/compaction defaults
  would change the required pre-mechanism baseline. A probe confirms native
  Harness supports active switching; evaluate it for the later mechanism unit.
- Rifty entry/transport registry above pi: rejected; Models/createProvider
  already own lookup/auth/dispatch.
- Retain legacy settings or descriptor-free StreamFn: rejected by the user's
  explicit catalog-only decision; neither states an honest model window.

## Consequences

- Breaking 0.x API migration for all consumers; no npm publication in this PR.
- Explicit catalog parameters replace implicit 128k/8192 defaults in sessions.
- Providers own credential resolution and wire semantics; no fallback guessing.
