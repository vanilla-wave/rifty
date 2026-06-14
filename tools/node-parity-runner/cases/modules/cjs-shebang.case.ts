import type { ParityCase } from '../../src/types.ts';

// Node strips a leading `#!` shebang line from a CJS module before compiling
// (Module._compile → stripShebang) and runs the rest. rifty's CJS loader must
// match: an installed-CLI launcher shim begins with `#!/usr/bin/env node`
// (ADR-0137), and `node <script>`/child_process spawn a shebang'd entry. The
// shebang must NOT reach `new Function` (it throws "Invalid or unexpected
// token") — strip it, keep line numbers, run the body.
const c: ParityCase = {
  code: "#!/usr/bin/env node\nconsole.log('shebang-cjs-ran');\nconsole.log(2 + 3);\n",
};

export default c;
