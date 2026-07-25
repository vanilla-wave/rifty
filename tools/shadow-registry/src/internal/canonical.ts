import { shadowSha256 } from './sync-sha256.ts';
export { shadowSha256 } from './sync-sha256.ts';

export function decodeDenseDataArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${label} has symbol fields`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) {
    throw new TypeError(`${label} has an invalid length`);
  }
  const lengthValue: unknown = Reflect.get(lengthDescriptor, 'value');
  if (typeof lengthValue !== 'number' || !Number.isSafeInteger(lengthValue) || lengthValue < 0) {
    throw new TypeError(`${label} has an invalid length`);
  }
  const length = lengthValue;
  const expected = ['length', ...Array.from({ length }, (_, index) => String(index))].sort();
  const actual = Object.keys(descriptors).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} must be dense and have no extra fields`);
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label}[${index}] must be a data element`);
    }
    output.push(Reflect.get(descriptor, 'value') as unknown);
  }
  return output;
}

export function canonicalShadowJson(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (input: unknown): string => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean')
      return JSON.stringify(input);
    if (typeof input === 'number') {
      if (!Number.isSafeInteger(input) || input < 0 || Object.is(input, -0)) {
        throw new TypeError('shadow canonical JSON accepts non-negative safe integers only');
      }
      return String(input);
    }
    if (
      typeof input !== 'object' ||
      (Object.getPrototypeOf(input) !== Object.prototype && !Array.isArray(input))
    ) {
      throw new TypeError('shadow canonical JSON accepts arrays and plain objects only');
    }
    if (ancestors.has(input)) throw new TypeError('shadow canonical JSON rejects cycles');
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        return `[${decodeDenseDataArray(input, 'shadow canonical array').map(encode).join(',')}]`;
      }
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (Object.getOwnPropertySymbols(input).length > 0)
        throw new TypeError('shadow canonical JSON rejects symbols');
      return `{${Object.keys(descriptors)
        .sort()
        .map((key) => {
          const descriptor = descriptors[key];
          if (!descriptor || !('value' in descriptor))
            throw new TypeError('shadow canonical JSON rejects accessors');
          return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
        })
        .join(',')}}`;
    } finally {
      ancestors.delete(input);
    }
  };
  return encode(value);
}

export function shadowDigest(value: unknown): string {
  return shadowSha256(canonicalShadowJson(value));
}
