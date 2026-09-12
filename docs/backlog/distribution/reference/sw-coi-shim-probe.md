# SW-delivered COI probe — rejected route record (2026-08-31)

Why this file: `/tmp` artifacts rot (declined-concepts row on ownerless
artifacts). The probe that closed `no-coi-sandbox-tier` fog question 1 is
inlined here as the durable record. Run: `/tmp/rifty-coi-shim-probe-20260831`
(minimal static page + `coi-sw.js` + CDP-driven Chrome), disposable.

## Question

Does a coi-serviceworker-style header-faking Service Worker deliver REAL COI
(`crossOriginIsolated === true`, `SharedArrayBuffer` constructible) on a page
served with no COOP/COEP headers?

## Answer: yes — and that is exactly why the route is rejected

Chrome `151.0.7922.174` (headless, CDP), origin `http://127.0.0.1:41739/`
(secure context), server sends NO COOP/COEP:

| load | controlled by SW | `crossOriginIsolated` | `SharedArrayBuffer` |
|---|---|---|---|
| 1st (headerless, network) | no | `false` | `ReferenceError: SharedArrayBuffer is not defined` |
| 2nd (after SW install + reload) | yes | `true` | constructed, `byteLength 16` |

Headers on the SW-served document response:
`Cross-Origin-Opener-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: credentialless`,
`Cross-Origin-Resource-Policy: cross-origin`.

Legal, not a Chrome bug — composition of specified mechanisms: a SW may replace
a navigation response (Service Workers §respondWith), COOP/COEP are not
forbidden response headers (Fetch), and HTML computes isolation from the final
response header list, not from the wire.

## Why the route does not reach this epic's value

The discriminator is NOT which COOP value the shim picks — it is that ANY
isolation route applies new policy headers to the WHOLE host document and needs
a bootstrap reload to do it. An existing app cannot embed rifty invisibly under
those terms, which is the epic's reason to exist (user, 2026-08-31). Recorded as
`rejected route: … — violates I9` in the goal.

Per-flavor, so the rejection cannot be read as resting on one probed
combination:

| Variant | Isolation | Still rejected because |
|---|---|---|
| `COOP: same-origin` + COEP (probed above) | yes | severs `window.opener` for cross-origin popups (OAuth/payment) AND changes cross-origin subresource loading AND needs the reload |
| `COOP: restrict-properties` + COEP (NOT probed) | Chrome's popup-preserving variant | isolation still requires COEP on the host document — cross-origin subresource loading changes for the whole page — and the reload remains; opener survival does not restore the app's original posture |
| any of them served by real server headers instead of a SW | yes | that is the COI product path, out of this epic by definition |

So the unprobed `restrict-properties` variant weakens only the popup half of the
argument, not the rejection: the host document still stops being the document
the adopter shipped. If a future goal ever wants isolation WITH popups intact,
`restrict-properties` is the variant to probe first — nothing here settles it.

Also true regardless of flavor: the first uncontrolled load is never isolated,
so every SW route carries a bootstrap reload with SW-lifecycle semantics.

## Reuse

If a future goal WANTS a COI page on headerless hosting (a rifty-owned page,
not an adopter's app), this probe is the evidence that it works — re-verify
against the then-current Chrome before building on it.
