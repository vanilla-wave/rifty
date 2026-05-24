# @rifty/service-worker

Service Worker that will eventually intercept `fetch` and route requests to listening Worker processes (M7).

For M0 it just registers itself and serves a `pong` ping endpoint so the host can verify it's alive.
