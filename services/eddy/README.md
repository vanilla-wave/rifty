# @riftydev/eddy

Opt-in **fast `npm install`** resolver service for rifty (ADR-0182). Cold,
no-lockfile install in a browser tab pays two latency-bound waterfalls
(packument metadata + many small tarballs over one coalesced h2 connection);
neither is fixable client-side. Eddy collapses both into **one** round-trip.

It runs rifty's OWN resolution server-side — it imports `@riftydev/npm-client`
and calls the same `install()` the client uses (ONE algorithm, zero drift) —
then returns one `EddyBundleV1`: a tar of the v3 `package-lock.json` + each
package's original gzip tarball. The client pre-seeds its tarball cache + writes
the lockfile, then the existing lockfile fast path installs with **zero
packument network**.

Eddy is **opt-in** and **additive**: the standard verifying install is
untouched and is the always-on fallback. If eddy is absent, unreachable, or
returns anything that fails integrity/coverage, the client runs the standard
install instead — a user never gets a wrong or failed install because the fast
path was down.

## Run

```sh
PORT=8788 REGISTRY_BASE_URL=https://registry.npmjs.org npx @riftydev/eddy
```

POST a dep-set (`{ dependencies, devDependencies, optionalDependencies,
overrides, prefer }`); receive a streamed `EddyBundleV1` (`application/x-tar`)
or a `422` typed `{ kind: 'unsupported', feature, message }` decline.

## Trust

Mirror-grade (ADR-0182 §5, `docs/public/trust-model.md`): the client verifies
each tarball's bytes against the integrity carried in eddy's bundle, NOT against
npm's source-of-truth — you trust the eddy operator exactly as you trust a
registry mirror. Self-hostable (npm + Docker) so the speedup stays a property of
the open, auditable stack.
