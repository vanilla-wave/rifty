function invalid(detail: string): never {
  throw new TypeError(`package.json ${detail}`);
}

function canonicalArray(value: readonly unknown[], ancestors: Set<object>): string {
  if (Object.getPrototypeOf(value) !== Array.prototype) invalid('arrays must be plain');
  const elements: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined) invalid('arrays cannot be sparse');
    if (!descriptor.enumerable || !('value' in descriptor)) {
      invalid('arrays must contain enumerable data entries');
    }
    elements.push(canonicalJson(descriptor.value, ancestors));
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string') invalid('arrays cannot contain symbol properties');
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) {
      invalid('arrays cannot contain extra properties');
    }
  }
  return `[${elements.join(',')}]`;
}

function canonicalRecord(value: object, ancestors: Set<object>): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid('objects must be plain');
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') invalid('objects cannot contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalid('objects must contain enumerable data properties');
    }
    entries.push([key, descriptor.value]);
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry, ancestors)}`)
    .join(',')}}`;
}

function canonicalJson(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('package.json numbers must be finite');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError(`package.json cannot contain ${typeof value}`);
  }
  if (ancestors.has(value)) invalid('cannot contain circular references');
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? canonicalArray(value, ancestors)
      : canonicalRecord(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/** One byte-exact package manifest spelling across acquisition and runtimes. */
export function serializePackageJson(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('package.json must be an object');
  }
  return `${canonicalJson(value, new Set())}\n`;
}
