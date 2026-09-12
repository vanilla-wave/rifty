# RECHART — make the map match known obligations

The driver runs this immediately after a slice, a technical impasse, or a fact
that changes the route. No new context for bookkeeping.

1. Record decisions and useful observations once in the ledger. History does
   not become a new obligation merely because it was written down.
2. Resolve known questions, update dependencies and choose the next unblocked
   unit. Route verified work by `REV-12`; scope changes follow `RDY-6`.
3. Required unfinished work remains linked to the goal, with the next probe or
   design that can settle it. Continue independent work. Revert unsafe partial
   product/test changes before another unit relies on that tree; retain their
   evidence and git history. Do not erase the outstanding obligation.
4. For a landed slice append `re-chart after <slice> (final-green PASS @ <sha>):
   <what changed>`; this is a navigation reference to the verdict (`REV-8`).
   Remove the completed item from the map and optionally delete its draft.

Done when the map matches remaining obligations. An empty map is not proof
that the goal is complete; CLOSE verifies the accepted destination.
