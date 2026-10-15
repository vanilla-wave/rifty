Build a shared-expense settlement application on this installed minimal Svelte
starter. Create named people, trimmed and unique case-insensitively. Delete an
unreferenced person; reject deletion while any expense references them as payer
or participant, preserving all state.

Create/edit/delete expenses with nonempty trimmed description, payer, positive decimal amount
and one or more selected participants. Payer may be outside the participants.
Amounts use a decimal point and at most two fractional digits, producing safe
integer cents; reject empty, zero, negative, excess precision/nondecimal values.
Invalid creation/edit preserves prior expenses. Each expense splits equal cents:
floor(amount/participant-count) each, remainder cents distributed one per person
in person-creation order among selected participants. Preserve that order on reload.

For every person show paid, owed and signed net=paid-owed. Exact integer-cent
arithmetic, sum(net)=0. Propose nonzero transfers from debtors to creditors that
clear every net exactly; any valid settlement is accepted, no fixed greedy/order
algorithm. Make each transfer's payer, receiver and amount readable and named.
Edits/deletions recompute all totals/transfers. People and expenses persist
across reload; rejected operations never silently alter/persist records.

Provide accessible Person name and Expense description/Payer/Amount/Participants
controls; named person/expense add/save/edit/delete actions and participant choices.
Make per-person Paid/Owed/Net outputs accessible with person identity. Standard
checkboxes, selection controls or named toggle buttons are all valid for choices;
DOM/layout/component structure/settlement algorithm are open. Currency display
may use symbols; retain exact signed two-decimal amounts. No sample-data hardcoding.
