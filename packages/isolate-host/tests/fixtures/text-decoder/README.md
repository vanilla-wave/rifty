# TextDecoder corpus (ADR-0577)

- `cases.cjs`: the corpus of `docs/backlog/epics/isolate-guest-web-api/reference/textdecoder`
  (every single byte, every 2-byte sequence, gb18030 4-byte and euc-jp 3-byte forms sampled,
  random and `stream: true` splits, BOM rules, a utf-8 set), unchanged; self-contained, runs in
  Node and in the guest.
- `encodings.json`: WHATWG Encoding `encodings.json` at `7d2e3e08e1`, unchanged (sha256
  `078212b3697f60b81225b6671bd9da2604497abff0aa8e96e4d46605c02ac9e7`), the 228 labels.
