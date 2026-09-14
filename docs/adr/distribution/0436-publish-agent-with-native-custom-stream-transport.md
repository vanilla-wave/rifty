# ADR 0436: Publish agent with native custom stream transport

Status: Accepted
Date: 2026-09-14

> TL;DR: publish `@riftydev/agent` in lockstep; custom model transport uses Pi's
> native `StreamFn` without invented OpenAI settings

## Context

ADR-0424 delivered a private headless Pi agent and deliberately left publication
separate. An external browser embedder needs the agent loop while owning model
selection, wire/auth and domain tools. Today `AgentSessionOptions` always requires
an OpenAI-compatible base URL/model, even when `streamFn` owns the request. The
trace then claims those synthetic settings. Standard shell/preview results also
keep exit/HTTP outcome only in Pi `details`; Pi's OpenAI serializer sends text and
can make quiet success, failure and cancellation identical.

Publishing the package and its Pi types is irreversible. Reference evidence:
`docs/backlog/distribution/reference/public-agent-release-readiness-evidence.md`.

## Decision

1. Add `@riftydev/agent` to the generated public-package SPEC as a pure package
   with only its root export. It joins the existing tag-derived lockstep set;
   Pi core/ai stay exact public MIT dependencies at 0.85.1.
2. `AgentSessionOptions` has two exclusive transport forms. The existing
   OpenAI-compatible form requires settings and optional fetch. The custom form
   requires Pi's native `StreamFn` and no endpoint/model/fetch settings. Shared
   run limits live outside transport settings. No second callback, provider
   catalogue or model-selection API.
3. Custom transport uses Pi's built-in unknown model state only as the native
   loop parameter; the callback owns its actual model and returns authoritative
   assistant metadata. Trace config identifies the transport without claiming a
   custom endpoint/model; transcript response metadata remains exact.
4. Rifty-owned shell and preview-fetch tools put shell status, exit code, error,
   worker/effects or HTTP status in their capped text before body/output.
   Structured `details` remain. Consumer tools remain responsible for their own
   model-facing text.
5. Agent errors stay product-neutral. Playground-only CORS/proxy guidance is
   composed in the Playground UI.
6. The PR makes the package release-ready but does not mutate npm. First-name
   bootstrap, trusted-publisher registration and the release tag remain
   confirm-first operations.

## Alternatives

- Publish unchanged and require dummy settings or an embedder wrapper: rejected;
  public traces and quiet tool outcomes would remain misleading.
- Add a rifty-specific callback/model/domain abstraction: rejected; native Pi
  `StreamFn` already carries context, tools and abort, and ADR-0424 assigns wire
  and domain policy to the consumer.
- Delay publication for chat restore, model picker or cross-origin DOM preview:
  rejected; none is required for the headless edit/build flow.

## Consequences

- External browser apps can install the agent and supply one native callback
  without fictitious transport configuration.
- The public surface includes Pi 0.85.1 message/tool/stream types and remains
  pinned until a separately reviewed upgrade.
- Existing OpenAI-compatible Playground behavior remains, including local proxy
  guidance at its UI boundary.
- Tagged releases publish 17 names after one-time agent bootstrap/trust setup.
