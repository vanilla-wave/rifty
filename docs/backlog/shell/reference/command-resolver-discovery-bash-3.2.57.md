# Command resolution/discovery reference — GNU bash 3.2.57

Captured 2026-08-23 on `GNU bash, version 3.2.57(1)-release
(arm64-apple-darwin25)`. This is a frozen shell-conformance reference under
ADR-0093, not a live CI oracle. Node target on the capture host: `v24.16.0`.

Fixture: `<ROOT>/scripts/tool` and both ancestor
`<ROOT>/{,packages/app/}node_modules/.bin/vite` are executable links to
`/bin/echo`. `PATH` orders the nearer `.bin` before the ancestor and host paths.

```sh
printf 'builtin='; command -v echo
printf 'bare='; command -v vite
printf 'direct-relative='; command -v ./scripts/tool
printf 'direct-absolute='; command -v "$PWD/scripts/tool"
printf 'which-direct='; /usr/bin/which ./scripts/tool
printf 'missing-relative='; command -v ./scripts/missing || printf 'MISS:%s\n' "$?"
printf 'directory='; command -v ./scripts || printf 'MISS:%s\n' "$?"
./scripts/tool direct-ok
./scripts/missing 2>&1 || printf 'missing-exit=%s\n' "$?"
./scripts 2>&1 || printf 'directory-exit=%s\n' "$?"
./scripts/tool/child 2>&1 || printf 'enotdir-exit=%s\n' "$?"
printf 'completion='; compgen -c vi | LC_ALL=C sort -u | tr '\n' ','; printf '\n'
```

Normalized output (`$PWD` → `<ROOT>`):

```text
builtin=echo
bare=<ROOT>/node_modules/.bin/vite
direct-relative=./scripts/tool
direct-absolute=<ROOT>/scripts/tool
which-direct=./scripts/tool
missing-relative=MISS:1
directory=MISS:1
direct-ok
bash: ./scripts/missing: No such file or directory
missing-exit=127
bash: ./scripts: is a directory
directory-exit=126
bash: ./scripts/tool/child: Not a directory
enotdir-exit=126
completion=vi,view,viewdiagnostic,vim,vimdiff,vimtutor,vis,vite,
```

From `<ROOT>/packages/app/src` with npm-style ancestor `.bin` PATH order:

```sh
printf 'nearest='; command -v vite
printf 'which-nearest='; /usr/bin/which vite
```

```text
nearest=<ROOT>/packages/app/node_modules/.bin/vite
which-nearest=<ROOT>/packages/app/node_modules/.bin/vite
```

Rifty has no executable-mode bit, host PATH, or native process launcher. ADR-0362
therefore copies the observable selection/error classes while defining a regular
VFS file reached by an explicit path as an existing Node-entry carrier.
