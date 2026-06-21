/**
 * `node:http.METHODS` + `http.maxHeaderSize` static surface.
 *
 * `METHODS` is a faithful copy of Node v24's sorted HTTP method list, read by
 * per-verb routers (`http.METHODS.includes(req.method)`). Like `STATUS_CODES`,
 * parity pins a stable membership subset (not the exact count) so a future Node
 * adding a verb does not falsely fail. Kept a plain mutable array to match
 * Node's own export shape.
 *
 * `maxHeaderSize` mirrors Node's 16384-byte default. ADVISORY ONLY (compat ⚠️):
 * rifty frames HTTP through the SW/fetch bridge, which the runtime cannot make
 * enforce this limit — never claim header-framing enforcement from this value.
 */
export const METHODS: string[] = [
  'ACL',
  'BIND',
  'CHECKOUT',
  'CONNECT',
  'COPY',
  'DELETE',
  'GET',
  'HEAD',
  'LINK',
  'LOCK',
  'M-SEARCH',
  'MERGE',
  'MKACTIVITY',
  'MKCALENDAR',
  'MKCOL',
  'MOVE',
  'NOTIFY',
  'OPTIONS',
  'PATCH',
  'POST',
  'PROPFIND',
  'PROPPATCH',
  'PURGE',
  'PUT',
  'QUERY',
  'REBIND',
  'REPORT',
  'SEARCH',
  'SOURCE',
  'SUBSCRIBE',
  'TRACE',
  'UNBIND',
  'UNLINK',
  'UNLOCK',
  'UNSUBSCRIBE',
];

export const maxHeaderSize = 16384;
