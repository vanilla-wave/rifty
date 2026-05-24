# @rifty/terminal

Framework-agnostic xterm.js wrapper + PTY-style abstraction. No SolidJS or other UI deps.

The host (playground UI) mounts the terminal into a DOM element and wires `onInput` to the runtime; the runtime writes back via `write`/`writeError`.
