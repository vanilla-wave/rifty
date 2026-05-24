# Changelog

## [Unreleased]

### Added

- `registerServiceWorker(scriptUrl, options)` helper for the host.
- `sw.ts` worker source: installs/activates, claims clients, responds to `__rifty_sw_ping__` for liveness.
- **M10:** Preview bridge — `installPreviewInterceptor(self)` matches `/preview/<port>/*` and forwards to the first window client over `MessageChannel`. `setupPreviewBridge(handler)` on the main thread answers with a serialised response. 3 URL-matcher unit tests.
