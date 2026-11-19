## Items

1. `distribution/isolate-shared-array-buffer` — commit the executable scenario RED at both public entry points, then implement to GREEN.

## Open questions

- Verify enforcement on the supported engine and the packed embedder — owner: agent — real worker tests, reference Node, mutations and independent review.

## Out of scope

- Timer precision, cross-tenant side channels, shared linear memory used entirely inside wasm.
