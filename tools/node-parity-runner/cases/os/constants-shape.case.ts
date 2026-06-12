import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const os = require('node:os');
    console.log(typeof os.constants.signals.SIGTERM);
    console.log(typeof os.constants.signals.SIGINT);
    console.log(typeof os.constants.errno.ENOENT);
    console.log(typeof os.constants.errno.EINVAL);
    console.log(os.constants.signals.SIGTERM !== os.constants.signals.SIGINT);
    console.log(os.constants.errno.ENOENT !== os.constants.errno.EINVAL);
    console.log(os.constants.errno.ENOENT);
    console.log(os.constants.errno.EINVAL);
  `,
};

export default c;
