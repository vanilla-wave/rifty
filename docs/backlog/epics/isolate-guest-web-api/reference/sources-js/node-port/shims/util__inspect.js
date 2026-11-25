// internal/util/inspect: minimal; the guest would bind rifty's util.inspect.
function inspect(v) {
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'symbol') return v.toString();
  if (typeof v === 'function') return `[Function: ${v.name || '(anonymous)'}]`;
  if (v === null || typeof v !== 'object') return String(v);
  return Array.isArray(v) ? `[ ${v.map(inspect).join(', ')} ]` : '{}';
}
function format(...args) {
  const [f, ...rest] = args;
  if (typeof f !== 'string') return args.map(inspect).join(' ');
  let i = 0;
  return f.replace(/%[sdjoOi%]/g, (m) =>
    m === '%%'
      ? '%'
      : i < rest.length
        ? m === '%s' && typeof rest[i] === 'string'
          ? rest[i++]
          : inspect(rest[i++])
        : m,
  );
}
module.exports = { inspect, format };
