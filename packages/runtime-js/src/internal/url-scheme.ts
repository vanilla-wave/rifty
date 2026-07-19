const charCodeAtPrimordial = String.prototype.charCodeAt;
const reflectApplyPrimordial = Reflect.apply;

function asciiLowerCode(code: number): number {
  return code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
}

/** Match a URL scheme without changing the rest of the specifier. */
export function hasURLScheme(value: string, scheme: string): boolean {
  if (value.length <= scheme.length || value[scheme.length] !== ':') return false;
  for (let index = 0; index < scheme.length; index += 1) {
    const actual = reflectApplyPrimordial(charCodeAtPrimordial, value, [index]) as number;
    const expected = reflectApplyPrimordial(charCodeAtPrimordial, scheme, [index]) as number;
    if (asciiLowerCode(actual) !== asciiLowerCode(expected)) return false;
  }
  return true;
}
