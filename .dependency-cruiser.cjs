/** check:arch pass 1 — emitted runtime topology. */
const { runtimeOptions, runtimeTopologyRules } = require('./tools/checks/arch-rules.cjs');

module.exports = { forbidden: runtimeTopologyRules, options: runtimeOptions };
