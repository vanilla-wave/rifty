import { expect, it } from 'vitest';
import { applyAutocompleteItem, createAutocompleteState } from './autocomplete.ts';

const result = {
  start: 4,
  end: 6,
  items: [
    { value: 'alpha ', display: 'alpha' },
    { value: 'alpine ', display: 'alpine' },
  ],
};

it('creates a bounded dropdown state from completion results', () => {
  expect(createAutocompleteState(result)).toEqual({
    start: 4,
    end: 6,
    index: 0,
    items: result.items,
  });
});

it('applies the selected completion range and returns the next caret', () => {
  expect(applyAutocompleteItem('cmd al --flag', result, result.items[1])).toEqual({
    line: 'cmd alpine  --flag',
    cursor: 11,
  });
});
