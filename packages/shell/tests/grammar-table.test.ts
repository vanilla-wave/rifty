/**
 * The tokenizer's operator and reserved-word tables equal the frozen closed
 * list (fixtures/bash/grammar-table.json: POSIX XCU Issue 7 + bash 3.2.57
 * forms), and every entry is pinned by a frozen bash fixture row whose rifty
 * contract is the entry's own token or gap.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPERATORS, RESERVED_WORDS } from '../src/tokenize.ts';
import { bashCases, expectation } from './_bash-fixture.ts';

interface Entry {
  readonly text?: string;
  readonly word?: string;
  readonly rifty?: string;
  readonly fixture: string;
}

const table = JSON.parse(
  readFileSync(new URL('../fixtures/bash/grammar-table.json', import.meta.url), 'utf8'),
) as {
  readonly operators: readonly Entry[];
  readonly reservedWords: readonly Entry[];
  readonly reservedWordGap: string;
  readonly ioNumber: { readonly fixtures: readonly string[] };
  readonly excluded: readonly { readonly text: string }[];
};

const ids = new Set(bashCases.map((c) => c.id));
const pinned = (id: string, contract: string): void => {
  expect(ids.has(id), `fixture row ${id}`).toBe(true);
  if (contract.startsWith('shell.')) expect(expectation(id), id).toBe(contract);
};

describe('closed shell grammar table', () => {
  it('lexes exactly the frozen operators', () => {
    expect(OPERATORS).toEqual(Object.fromEntries(table.operators.map((e) => [e.text, e.rifty])));
    for (const { text } of table.excluded) expect(Object.hasOwn(OPERATORS, text)).toBe(false);
  });

  it('reserves exactly the frozen words', () => {
    expect([...RESERVED_WORDS].sort()).toEqual(table.reservedWords.map((e) => e.word).sort());
  });

  it('pins every entry with a frozen bash row', () => {
    for (const e of table.operators) pinned(e.fixture, e.rifty ?? '');
    for (const e of table.reservedWords) pinned(e.fixture, table.reservedWordGap);
    for (const id of table.ioNumber.fixtures) pinned(id, '');
  });
});
