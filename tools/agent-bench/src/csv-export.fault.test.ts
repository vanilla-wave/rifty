import { expect, it } from 'vitest';
import { csvExportMatches } from './judge/context.ts';

it('accepts RFC4180 optional quoting/header/line ending with exact decoded rows', () => {
  const rows = [['Bob "B"', 'bob@example.test']];
  for (const text of [
    'name,email\n"Bob ""B""",bob@example.test',
    '"name","email"\r\n"Bob ""B""","bob@example.test"\r\n',
    '"Bob ""B""","bob@example.test"',
  ])
    expect(csvExportMatches(text, rows), text).toBe(true);
  expect(csvExportMatches('"Alice, A","a@example.test"', [['Alice, A', 'a@example.test']])).toBe(
    true,
  );
  expect(
    csvExportMatches('"line1\r\nline2",a@example.test', [['line1\r\nline2', 'a@example.test']]),
  ).toBe(true);
});

it('rejects corrupt escaping, wrong/extra/missing/duplicate records instead of matching substrings', () => {
  const rows = [['Bob "B"', 'bob@example.test']];
  for (const text of [
    'name,email\n"Bob "B"",bob@example.test',
    'name,email\n"Bob ""B""",bob@example.test,extra',
    'name,email\n"Bob ""B""",bob@example.test\nAlice,alice@example.test',
    'name,email\n"Bob ""B""",bob@example.test\n"Bob ""B""",bob@example.test',
    'name,email',
    'name,email\nBob B,bob@example.test',
  ])
    expect(csvExportMatches(text, rows), text).toBe(false);
});

it('rejects text after a closing quote, quotes inside bare fields and unfinished quoted input', () => {
  expect(csvExportMatches('"Bob"junk,bob@example.test', [['Bobjunk', 'bob@example.test']])).toBe(
    false,
  );
  expect(csvExportMatches('Bob "B",bob@example.test', [['Bob B', 'bob@example.test']])).toBe(false);
  expect(csvExportMatches('"unfinished', [])).toBe(false);
});

it('interprets semantic column headers independent of casing, descriptions and order', () => {
  const rows = [['Bob "B"', 'bob@example.test']];
  for (const text of [
    'Name,Email\r\n"Bob ""B""",bob@example.test',
    '"NAME","Email"\n"Bob ""B""","bob@example.test"',
    'Email,Name\n"bob@example.test","Bob ""B"""',
    '"E-mail address","Contact name"\n"bob@example.test","Bob ""B"""',
  ])
    expect(csvExportMatches(text, rows), text).toBe(true);
  expect(csvExportMatches('Name,email@example.test\n"Bob ""B""",bob@example.test', rows)).toBe(
    false,
  );
  expect(csvExportMatches('Name and Email,Email\n"Bob ""B""",bob@example.test', rows)).toBe(false);
});
