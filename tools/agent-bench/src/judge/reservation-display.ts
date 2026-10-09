import type { JudgeContext } from './context.ts';
import { publicRecordValuePattern } from './public-record-display.ts';
import type { ReservationRecord } from './reservation-records.ts';

/** Core fields belong to one output; room/date may be declared by its readonly grouping. */
export async function reservationDisplay(
  ctx: JudgeContext,
  record: ReservationRecord,
  known: readonly ReservationRecord[],
): Promise<{ present: boolean; count: number; position: { top: number; left: number } | null }> {
  const core = (value: ReservationRecord) =>
    [value.start, value.end, String(value.seats)].map(
      (value) => publicRecordValuePattern(value).source,
    );
  const query = {
    core: core(record),
    context: [
      publicRecordValuePattern(record.room).source,
      publicRecordValuePattern({ calendarDate: record.date }).source,
    ],
    peers: known.map((value) => core(value).slice(0, 2)),
  };
  return ctx.view.locator('body').evaluate((root, query) => {
    type Atom = { owner: Element; text: string; id: number };
    type Span = { id: number; start: number; end: number };
    const atoms: Atom[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement;
      if (
        !owner ||
        owner.closest(
          'button,a,input,textarea,select,script,style,[contenteditable],[role="button"],[role="link"]',
        )
      )
        continue;
      const style = getComputedStyle(owner);
      const range = document.createRange();
      range.selectNode(node);
      if (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        range.getClientRects().length
      )
        atoms.push({ owner, text: node.textContent ?? '', id: atoms.length });
    }
    for (const input of root.querySelectorAll('input,textarea,select')) {
      const style = getComputedStyle(input);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        !input.getClientRects().length
      )
        continue;
      if (
        input instanceof HTMLInputElement &&
        (input.readOnly || input.disabled) &&
        ['text', 'number', 'date', 'time'].includes(input.type)
      )
        atoms.push({ owner: input, text: input.value, id: atoms.length });
      if (input instanceof HTMLTextAreaElement && (input.readOnly || input.disabled))
        atoms.push({ owner: input, text: input.value, id: atoms.length });
      if (input instanceof HTMLSelectElement && input.disabled)
        atoms.push({
          owner: input,
          text: [...input.selectedOptions].map((option) => option.label).join(' '),
          id: atoms.length,
        });
    }
    // Methods retain their own browser-side names; serialized callbacks have no transpiler globals.
    const operations = {
      eligible(element: Element): boolean {
        return (
          element !== root &&
          !element.querySelector(
            'input:not([readonly]):not([disabled]),textarea:not([readonly]):not([disabled]),select:not([disabled]),[contenteditable]',
          )
        );
      },
      under(element: Element, atom: Atom): boolean {
        return element === atom.owner || element.contains(atom.owner);
      },
      foreign(element: Element, candidate: Element, peer: Element, atom: Atom): boolean {
        if (peer === candidate || peer.contains(candidate)) return false;
        let branch = peer;
        while (
          branch.parentElement &&
          branch.parentElement !== element &&
          !branch.parentElement.contains(candidate)
        )
          branch = branch.parentElement;
        return operations.under(branch, atom);
      },
      overlaps(a: Span, b: Span): boolean {
        return a.id === b.id && a.start < b.end && b.start < a.end;
      },
      *allocations(values: Atom[], patterns: string[], held: Span[] = []): Generator<Span[]> {
        if (!patterns.length) {
          yield held;
          return;
        }
        for (const atom of values)
          for (const match of atom.text.matchAll(new RegExp(patterns[0]!, 'gi'))) {
            const span = { id: atom.id, start: match.index!, end: match.index! + match[0].length };
            if (held.some((prior) => operations.overlaps(prior, span))) continue;
            yield* operations.allocations(values, patterns.slice(1), [...held, span]);
          }
      },
      minimal(patterns: string[]): Element[] {
        const matches = scopes.filter(
          (element) =>
            !operations
              .allocations(
                atoms.filter((atom) => operations.under(element, atom)),
                patterns,
              )
              .next().done,
        );
        return matches.filter(
          (element) => !matches.some((other) => other !== element && element.contains(other)),
        );
      },
    };
    const scopes = [
      ...new Set(
        atoms.flatMap((atom) => {
          const values: Element[] = [];
          for (
            let element: Element | null = atom.owner;
            element && element !== root;
            element = element.parentElement
          )
            if (operations.eligible(element)) values.push(element);
          return values;
        }),
      ),
    ];
    const peers = [...new Set(query.peers.flatMap((patterns) => operations.minimal(patterns)))];
    const candidates = operations
      .minimal(query.core)
      .filter((element) => !peers.some((other) => other !== element && element.contains(other)));
    const found: Element[] = [];
    for (const candidate of candidates) {
      const coreAtoms = atoms.filter((atom) => operations.under(candidate, atom));
      let present = false;
      for (const used of operations.allocations(coreAtoms, query.core)) {
        // Determine nearest context before allocation. An occupied span never licenses a farther fallback.
        const contextual = query.context.map((pattern) => {
          for (
            let element: Element | null = candidate;
            element && element !== root;
            element = element.parentElement
          ) {
            if (!operations.eligible(element)) break;
            const allowed = atoms.filter(
              (atom) =>
                operations.under(element!, atom) &&
                !peers.some((peer) => operations.foreign(element!, candidate, peer, atom)),
            );
            const matches: Span[] = [];
            for (const atom of allowed)
              for (const match of atom.text.matchAll(new RegExp(pattern, 'gi')))
                if (
                  !used.some((prior) =>
                    operations.overlaps(prior, {
                      id: atom.id,
                      start: match.index!,
                      end: match.index! + match[0].length,
                    }),
                  )
                )
                  matches.push({
                    id: atom.id,
                    start: match.index!,
                    end: match.index! + match[0].length,
                  });
            if (matches.length) return matches;
          }
          return [];
        });
        let choices = [used];
        for (const selections of contextual)
          choices = choices.flatMap((choice) =>
            selections
              .filter((span) => !choice.some((prior) => operations.overlaps(prior, span)))
              .map((span) => [...choice, span]),
          );
        if (choices.length) {
          present = true;
          break;
        }
      }
      if (present) found.push(candidate);
    }
    let position: { top: number; left: number } | null = null;
    if (found.length === 1) {
      let rect = found[0]!.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        const range = document.createRange();
        range.selectNodeContents(found[0]!);
        rect = range.getBoundingClientRect();
      }
      position = { top: rect.top, left: rect.left };
    }
    return { present: found.length === 1, count: found.length, position };
  }, query);
}
