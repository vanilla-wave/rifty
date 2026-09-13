export const TOOL_RESULT_CAP_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function capToolText(text: string, cap = TOOL_RESULT_CAP_BYTES): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= cap) return text;
  let reserved = 64;
  for (;;) {
    let head = Math.floor((cap - reserved) / 2);
    let tail = bytes.length - (cap - reserved - head);
    while (head > 0 && ((bytes[head] ?? 0) & 0xc0) === 0x80) head--;
    while (tail < bytes.length && ((bytes[tail] ?? 0) & 0xc0) === 0x80) tail++;
    const marker = `\n[truncated ${tail - head} bytes]\n`;
    const result =
      decoder.decode(bytes.subarray(0, head)) + marker + decoder.decode(bytes.subarray(tail));
    if (encoder.encode(result).length <= cap) return result;
    reserved += encoder.encode(marker).length;
  }
}

export function projectPath(root: string, input: string): string {
  if (input.includes('\0')) throw new Error('File path contains NUL');
  const absolute = input.startsWith('/') ? input : `${root}/${input}`;
  const parts: string[] = [];
  for (const part of absolute.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) throw new Error('File path escapes project root');
      parts.pop();
    } else parts.push(part);
  }
  const result = `/${parts.join('/')}`;
  if (root !== '/' && result !== root && !result.startsWith(`${root}/`))
    throw new Error('File path escapes project root');
  return result;
}
