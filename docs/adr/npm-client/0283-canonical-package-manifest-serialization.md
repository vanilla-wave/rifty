# ADR 0283: Canonical package manifest serialization

Status: Accepted
Date: 2026-07

> TL;DR: npm-client exports the one canonical package.json serializer shared by
> Playground plans, snapshot tooling, and Workbench definitions.

## Context

App-owned `ProjectSpec` imported Workbench-internal bootstrap types and manifest
serialization. Extraction would either break that import or copy the algorithm.
The existing snapshot identity contract requires byte equality between template,
definition, and baked artifact manifests, so two serializers are not acceptable.

## Decision

`@riftydev/npm-client` exports `serializePackageJson(value)`. It accepts a JSON
object, recursively sorts object keys, preserves array order, rejects unsupported
values and non-finite numbers, and emits one trailing newline. App template/bake
code and Workbench definition normalization import this same function.

`BootstrapConfig` remains an App-owned temporary derived model; it no longer
imports Workbench internal types. Widening `PlaygroundProjectPlan` with bootstrap
or manifest machinery was rejected because it would export execution details.
Moving offline bake/template policy into Workbench was rejected as a larger
ownership rewrite unrelated to extraction.

## Consequences

- Manifest identity has one executable owner across browser and build tooling.
- npm-client gains one small deterministic public primitive.
- Workbench keeps package config and runtime wiring private; ProjectSpec remains
  App-owned and maps one way into neutral plans.
