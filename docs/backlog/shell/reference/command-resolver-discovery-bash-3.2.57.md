# Command resolution/discovery reference — GNU bash 3.2.57

Recaptured 2026-08-24 as a frozen shell-conformance reference under ADR-0093,
not a live CI oracle. The whole capture exported `LC_ALL=C` and `LANG=C` before
fixture setup or probing; `locale` reported every category as `C`.

Pinned capture host/tool identity:

- macOS `26.3.1`, build `25D2128`;
- `GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)`, invoked as
  `bash --noprofile --norc`, without `set -e` around command-status probes;
- Node `v24.16.0`;
- Apple `/usr/bin/which`, identifier `com.apple.which`, universal Mach-O,
  SHA-256 `3c8dc33bd21d5dc8c0857b4c430cc5e1636aae21c496b25e344dcb5867bdf19b`,
  CDHash `2e4de72048854ccde81ef5a92852ccdee9a5cec3`. It has no version flag:
  `/usr/bin/which --version` exits 1 with `illegal option -- -` and
  `usage: which [-as] program ...`;
- Apple `/usr/bin/sort` (`com.apple.sort`) SHA-256
  `d3fc034bf3184d57ba18017e7b2941652fba370e9992428c232e15d2cab81741` and
  `/usr/bin/tr` (`com.apple.tr`) SHA-256
  `be7e428ad7030f88b5eba0098b14ef68ecb3193d4f9670225cd05b54b7436b86`;
- fixture target `/bin/echo` (`com.apple.echo`) SHA-256
  `21172f3b7dc147d4303beb8b4dac059314b9c1fc194c2cfe1adabf94a06a5010`.

Identity commands:

```sh
export LC_ALL=C LANG=C
/bin/bash --version
node --version
locale
sw_vers
file /usr/bin/which /usr/bin/sort /usr/bin/tr /bin/echo
shasum -a 256 /usr/bin/which /usr/bin/sort /usr/bin/tr /bin/echo
codesign -dvvv /usr/bin/which 2>&1
/usr/bin/which --version; printf 'which-version-exit=%s\n' "$?"
```

Fixture: `<ROOT>/scripts/tool` and both
`<ROOT>/{,packages/app/}node_modules/.bin/vite` are executable links to
`/bin/echo`. At root, `PATH=<ROOT>/node_modules/.bin:/usr/bin:/bin`. From the
nested cwd, the nearer `.bin` is prepended before that exact root PATH.

```sh
export LC_ALL=C
export LANG=C
ROOT=$(mktemp -d -t rifty-command-resolver-oracle.XXXXXX)
mkdir -p "$ROOT/scripts" "$ROOT/node_modules/.bin"
mkdir -p "$ROOT/packages/app/node_modules/.bin" "$ROOT/packages/app/src"
ln -s /bin/echo "$ROOT/scripts/tool"
ln -s /bin/echo "$ROOT/node_modules/.bin/vite"
ln -s /bin/echo "$ROOT/packages/app/node_modules/.bin/vite"
cd "$ROOT"
export PATH="$ROOT/node_modules/.bin:/usr/bin:/bin"
bash --noprofile --norc <<'PROBE'
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
printf 'completion='; compgen -c vi | /usr/bin/sort -u | /usr/bin/tr '\n' ','; printf '\n'
PROBE
```

Normalized output: the one `mktemp` root is replaced by `<ROOT>` and
`bash: line <n>:` from the inner Bash capture is replaced by `bash:`. No other
output normalization is applied.

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
export LC_ALL=C
export LANG=C
cd "$ROOT/packages/app/src"
export PATH="$ROOT/packages/app/node_modules/.bin:$ROOT/node_modules/.bin:/usr/bin:/bin"
bash --noprofile --norc <<'PROBE'
printf 'nearest='; command -v vite
printf 'which-nearest='; /usr/bin/which vite
PROBE
```

```text
nearest=<ROOT>/packages/app/node_modules/.bin/vite
which-nearest=<ROOT>/packages/app/node_modules/.bin/vite
```

Rifty has no executable-mode bit, host PATH, or native process launcher. ADR-0362
therefore copies the observable selection/error classes while defining a regular
VFS file reached by an explicit path as an existing Node-entry carrier.
