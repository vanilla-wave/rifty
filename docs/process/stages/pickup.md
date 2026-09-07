# PICKUP — identify the authority and missing proof

Input: authorized work — a draft, observed defect, direct docs/code request,
or the goal's next unblocked unit. The driver stays in the same session.

1. Name the accepted result and its authority: scenario, invariant, ADR or
   observed baseline. New scope needs the user's decision (`RDY-6`).
2. For a draft, compile per `RDY-2`; resolve the premise check here, before
   committing to the plan. A question answered by a probe is answered here;
   keep a useful decision, otherwise delete the draft. No artificial second
   task to decline it. Already-authorized work continues automatically.
3. Identify the evidence still needed (`RDY-8`). New parity/stateful behavior
   requires Contract+RED before implementation; an observed defect needs its
   real baseline artifact and RED; existing certified proof is reused only
   for the same obligations. Docs need no product RED or contract document.
4. Run the missing preparation via `contract-red.md` / `rifty-fix`. If a doc
   exists, set it ready with its evidence references. A legacy ready status
   or old `review:` label supplies no missing evidence by itself.
5. Continue IMPLEMENT. Record a user choice when blocked; pursue technical
   questions in-session and independent units when available (`STOP-1..4`).

Done when the required pre-implementation proof exists. No membership flag,
size budget, document lifecycle, or PR shape substitutes for it.
