/**
 * `node:querystring`: Node v24.16.0's own `lib/querystring.js`, generated (ADR-0574). The same
 * object `url.parse(s, true)` calls, so a guest's `querystring.unescape` patch reaches it, as in Node.
 */
import { legacy } from './url-legacy/bindings.ts';

const querystring = legacy.querystring;
export default querystring;
