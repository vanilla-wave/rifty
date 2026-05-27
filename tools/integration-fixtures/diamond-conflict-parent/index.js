'use strict';

// Vendored fixture for the rifty nested-install regression test.
// Exercising the package end-to-end is out of scope; the test only asserts
// placement on disk and lockfile keys (see tests/integration/nested-install.test.ts).
// `require('ms')` from this package should resolve to the nested copy at
// `node_modules/diamond-conflict-parent/node_modules/ms/`, which is the
// 2.0.0 version that does not match the flat winner.
var ms = require('ms');

module.exports = function describe() {
  return 'diamond-conflict-parent uses ms ' + ms.toString();
};
