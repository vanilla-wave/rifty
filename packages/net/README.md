# @riftydev/net

Browser-side replacements for `node:net` and `node:http`.

The model: when a user app calls `net.createServer().listen(3000)`, we register an in-process handler in a port→handler table (the `net registry`). The Service Worker (M7) intercepts requests to `/preview/3000/...` and dispatches them to the registered handler. `http.request` / `http.get` loop back through that registry for registered local ports (`localhost`, `127.0.0.1`, `0.0.0.0`, IPv6 loopback) and otherwise use `fetch()`.

## Layout

- `src/registry.ts` — port table + dispatch (used by net + SW).
- `src/net.ts` — `node:net` (`Server`, `Socket`, `createServer`).
- `src/http.ts` — `node:http` (`Server`, `IncomingMessage`, `ServerResponse`, `request`, `get`, `createServer`).
