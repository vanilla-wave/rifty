# PR341 — retain rebaked snapshot registry inputs

BASE384fa18ed. CI38328248598/no-coi115071987677 fails before browser tests:
`Missing original npm fixture rollup@4.64.5`. Exact local real loader alsoRED.
Rebaked Vite snapshot's genuine transitive graph needs five new fixture versions:
Rollup/@rollup/wasm-node4.64.5,PostCSS8.5.30,nanoid3.3.20,source-map-js1.2.2.
Existing original fixture registry remained at the preceding bake.

Fault:sibling-drift/provenance-lie at snapshot lock→original registry fixture.
Fix only missing original exact-version metadata/tarballs and their provenance.
Responses fetched from each existing lock URL; metadata identity,tarball URL,
SHA512 and byte size verified. No repack,patch,synthetic archive,network fallback,
weakened loader or budget bump. Existing fixture bytes and npm-authored inputs
remain unchanged. Production source and prior campaign observations unchanged.

New permanent real-loader closure guard RED before inputs added; all declared
snapshot versions require original manifests/archives, correct SRI and loader
admission. Exact packed-client CI command validates real publish/build/browser
loading and the unchanged absolute client-bundle budgets.

Raw proofs:`pr-341-registry-fixture-repair-proof.json.gz`. Each of five missing
originals independently fails closure guard; exact provenance restored. Real
packedclient commandPASS:main87722/27472,sw15220/5327,generic774660/229732,
toolchain884661/267205 min/gzip bytes; all preexisting ceilings unchanged.
15firstparty+73external tarballs/typecheck/build/browser scenarios PASS.

Current fullpr:check27PASS:unit214.9s/parity112.7s, no isolated retries.
Prior source/fixture contracts remain intact; no remoteCI claim yet.

Independent unitFinal PASS @600a7db32cc34f3680c8af9960c62923ef292e67:
7coverage/8axes/findings0; accepted broader goal not reevaluated. Exact
`pr-341-registry-fixture-final-green.json`, raw
`pr-341-registry-fixture-final-green-evidence.json.gz`. CommittedguardPASS.
RemoteCI still pending next delivery.
