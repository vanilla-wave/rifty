# readable-stream trees — original npm fixtures

2026-11-17, Node v24.16.0 / npm 11.17.0. Each `v2`/`v3`/`v4` holds a root
manifest and its npm-authored v3 lock, generated in an empty temporary directory:

`npm install --package-lock-only --ignore-scripts --no-audit --no-fund --registry https://registry.npmjs.org --cache <temporary-cache>`

- `v2`: readable-stream 2.3.8 + through2 2.0.5 (unzipper 0.10 / exceljs line).
- `v3`: readable-stream 3.6.2 + through2 4.0.2.
- `v4`: readable-stream 4.7.0.

All three trees are flat. `packages/*.tgz`: original responses from each lock
`resolved` URL; never repacked or patched. `provenance.json` records URL,
version, SHA512 SRI and byte size; `src/npm-tree-files.ts` verifies them
against the lock before system `tar` extracts the archive for both runtimes.
22 tarballs, 269,608 bytes, 225 files, all UTF-8 text.
