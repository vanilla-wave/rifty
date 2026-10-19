# Map — no-coi-child-processes

## Items

1. `runtime-js/no-coi-child-processes` — native Worker + live owner FS through SW, Node acceptance.
2. Retire generated esbuild client/adapters — hypothesis after upstream carrier passes; packed artifact proof (I3).

## Open questions

- I3 depends on the existing COI cutover PR #379 (`esbuild-upstream-twin`) — owner: agent — integrate its reviewed result, reconcile shared stdio/ref repairs, then retire the remaining no-COI client in PR #380; destination unchanged.

- Acceptance and runtime gaps exposed by upstream bytes — owner: agent — run the shared Node/browser carrier after each repair.

## Out of scope

- COI child-process transport; worker_threads; synchronous child_process APIs.
- Independent FS progress while the owner runs uninterrupted synchronous guest JS.
