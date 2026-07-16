function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Project package.json numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') {
    throw new TypeError(`Project package.json cannot contain ${typeof value}`);
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

/** One byte-exact package manifest spelling for definitions, bake, and drift checks. */
export function serializeProjectPackageJson(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Project package.json must be an object');
  }
  return `${canonicalJson(value)}\n`;
}
