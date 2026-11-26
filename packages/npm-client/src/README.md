# npm-client owner

Registry acquisition, dependency request normalization, placement traversal,
lock replay, integrity/cache, unpacking and linking belong here. npm alias
keys own install paths; canonical package names own acquisition identity.
`internal/shadow/` owns registry substitution admission/materialization.
`dep-snapshot-envelope.ts` reads the dependency snapshot artifact's tar (strict:
ustar + PAX, envelope paths, manifest) for every consumer of it (Workbench
restore, isolate-host templates); `unpacker.ts` reads npm package tarballs,
which follow npm's looser conventions — two readers for two formats.

Shell argument/save behavior belongs in shell; project lifecycle and producing/applying
snapshots in Workbench; network transport policy in hosts; browser assets/substitution facts
in shadow-registry. Tests and `_test-fixtures/` prove real npm behavior.
