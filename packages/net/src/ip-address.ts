/** `net.isIP`/`isIPv4`/`isIPv6`: Node's grammar, shared with the isolate guest (`node-data.ts`). */
// Regex grammar from Node lib/internal/net.js; parity pins coercion and edge cases.
const v4Seg = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])';
const v4Str = `(?:${v4Seg}\\.){3}${v4Seg}`;
const IPv4Reg = new RegExp(`^${v4Str}$`);

const v6Seg = '(?:[0-9a-fA-F]{1,4})';
const IPv6Reg = new RegExp(
  `^(?:${[
    `(?:${v6Seg}:){7}(?:${v6Seg}|:)`,
    `(?:${v6Seg}:){6}(?:${v4Str}|:${v6Seg}|:)`,
    `(?:${v6Seg}:){5}(?::${v4Str}|(?::${v6Seg}){1,2}|:)`,
    `(?:${v6Seg}:){4}(?:(?::${v6Seg}){0,1}:${v4Str}|(?::${v6Seg}){1,3}|:)`,
    `(?:${v6Seg}:){3}(?:(?::${v6Seg}){0,2}:${v4Str}|(?::${v6Seg}){1,4}|:)`,
    `(?:${v6Seg}:){2}(?:(?::${v6Seg}){0,3}:${v4Str}|(?::${v6Seg}){1,5}|:)`,
    `(?:${v6Seg}:){1}(?:(?::${v6Seg}){0,4}:${v4Str}|(?::${v6Seg}){1,6}|:)`,
    `(?::(?:(?::${v6Seg}){0,5}:${v4Str}|(?::${v6Seg}){1,7}|:))`,
  ].join('|')})(?:%[0-9a-zA-Z-.:]{1,})?$`,
);

export function isIPv4(input: string): boolean {
  return IPv4Reg.exec(input) !== null;
}

export function isIPv6(input: string): boolean {
  return IPv6Reg.exec(input) !== null;
}

export function isIP(input: string): number {
  if (isIPv4(input)) return 4;
  if (isIPv6(input)) return 6;
  return 0;
}
