// One owner relay can briefly have old + new page clients alive at once (owner
// respawn, provider re-registration, late LS replies). Response fan-out reaches
// every subscribed client, so ids must be unique across the page realm, not just
// within one client instance.
let nextRequestId = 0;

export function nextTsLspRequestId(): number {
  return ++nextRequestId;
}
