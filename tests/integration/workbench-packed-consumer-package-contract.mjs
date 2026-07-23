function difference(left, right) {
  return [...left].filter((entry) => !right.has(entry)).sort();
}

export function assertExactFirstPartyImports(expected, actual) {
  const missing = difference(expected, actual);
  const unexpected = difference(actual, expected);
  if (missing.length === 0 && unexpected.length === 0) return;
  throw new Error(
    [
      missing.length === 0 ? null : `missing external imports: ${missing.join(', ')}`,
      unexpected.length === 0 ? null : `undeclared external imports: ${unexpected.join(', ')}`,
    ]
      .filter(Boolean)
      .join('; '),
  );
}
