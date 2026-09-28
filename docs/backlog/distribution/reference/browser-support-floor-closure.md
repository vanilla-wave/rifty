# Browser-support-floor scope amendment — 2026-09-28

User: «давай без физического прогона», after discussing Xcode Simulator versus
physical iOS hardware. This removes the remaining physical-iOS requirement;
it does not establish an iOS pass or make a simulator run mandatory.

Accepted I8/scenario 6 now retain the one-URL protocol and measured native
macOS Safari/Yandex rows, permit an explicitly unmeasured iOS row, and keep any
future simulator evidence distinct. Other I1–I9 obligations are unchanged.
Previous hardware-dependent closure decision is superseded by this user amendment.

Actual local simulator availability probe:

```text
xcode-select -p
/Library/Developer/CommandLineTools
xcrun simctl list devices available
xcrun: error: unable to find utility "simctl", not a developer tool or in PATH
```

No Xcode.app in /Applications; no simulator or iOS product result claimed.
Native iOS admission remains historical harness evidence, not product evidence.
Device memory, quota, eviction and persistence remain unmeasured.

Unchanged proof: prior full38-row independent review at10b1a14bf and follow-up
12-row review at9491c8d51; full local gate27/27 and final CI36449465390 at9ca45daa0
passed. Product source/tests/workflows unchanged by this amendment.
