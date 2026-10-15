# npm-client owner

Registry acquisition, dependency request normalization, placement traversal,
lock replay, integrity/cache, unpacking and linking belong here. npm alias
keys own install paths; canonical package names own acquisition identity.
`internal/shadow/` owns registry substitution admission/materialization.

Shell argument/save behavior belongs in shell; project lifecycle/snapshots in
Workbench; network transport policy in hosts; browser assets/substitution facts
in shadow-registry. Tests and `_test-fixtures/` prove real npm behavior.
