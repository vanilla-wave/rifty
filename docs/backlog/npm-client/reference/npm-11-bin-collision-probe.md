# npm 11 same-command bin collision probe

Recorded 2026-07-26 on Node v24.16.0 / npm 11.17.0 with local `file:`
dependencies only.

Two packages expose the same command:

```json
{"name":"provider-a","version":"1.0.0","bin":{"shared":"cli.js"}}
{"name":"provider-z","version":"1.0.0","bin":{"shared":"cli.js"}}
```

Each `cli.js` prints its package name. Two clean roots list the dependencies in
opposite manifest order:

```json
{"dependencies":{"provider-a":"file:../provider-a","provider-z":"file:../provider-z"}}
{"dependencies":{"provider-z":"file:../provider-z","provider-a":"file:../provider-a"}}
```

For each root:

```sh
npm install --ignore-scripts --no-audit --no-fund
node --version
npm --version
readlink node_modules/.bin/shared
node node_modules/.bin/shared
```

Both roots produced:

```text
v24.16.0
11.17.0
../provider-a/cli.js
provider-a
```

Incremental reconciliation was also order-independent. Installing only
`provider-z` first produced `../provider-z/cli.js`; adding `provider-a` to the
manifest and rerunning the same install changed the link to
`../provider-a/cli.js`.

Conclusion for one `node_modules` scope: npm 11 selects the lexicographically
first package name for a shared command and reconciles an existing link to that
winner. Manifest insertion order is not authority. A shadow acquisition twin
is not user-visible package authority and its bins remain excluded before this
policy runs.
