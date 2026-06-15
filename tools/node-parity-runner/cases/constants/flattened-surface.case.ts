import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const constants = require('node:constants');
    const fs = require('node:fs');
    const os = require('node:os');
    const crypto = require('node:crypto');

    // Print cross-platform / cross-build stable values, not only sibling-module
    // equality, so a bad hardcoded table fails against the Node oracle.
    console.log('fs', constants.O_RDONLY, constants.COPYFILE_EXCL);
    console.log('signals', constants.SIGHUP, constants.SIGINT, constants.SIGTERM);
    console.log('errno', constants.ENOENT, constants.EACCES);
    console.log('priority', constants.PRIORITY_LOW, constants.PRIORITY_NORMAL, constants.PRIORITY_HIGHEST);
    console.log('dlopen', constants.RTLD_NOW, constants.RTLD_NOW === os.constants.dlopen.RTLD_NOW);
    console.log(
      'crypto-rsa',
      constants.RSA_PKCS1_PADDING,
      constants.RSA_NO_PADDING,
      constants.RSA_PKCS1_OAEP_PADDING,
      constants.RSA_PKCS1_PSS_PADDING,
    );
    console.log(
      'crypto-stable',
      constants.POINT_CONVERSION_UNCOMPRESSED,
      constants.TLS1_2_VERSION,
      constants.TLS1_3_VERSION,
    );
    console.log('links', constants.O_RDONLY === fs.constants.O_RDONLY, constants.SIGTERM === os.constants.signals.SIGTERM);
    const desc = Object.getOwnPropertyDescriptor(constants, 'O_RDONLY');
    console.log('shape', Object.isFrozen(constants), desc.enumerable, desc.writable, desc.configurable);
  `,
};

export default c;
