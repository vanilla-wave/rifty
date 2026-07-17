/** check:arch pass 2 — compile-time dependency policy, including erased type edges. */
const { dependencyPolicyOptions, dependencyPolicyRules } = require('./tools/checks/arch-rules.cjs');

module.exports = {
  forbidden: dependencyPolicyRules,
  options: dependencyPolicyOptions,
};
