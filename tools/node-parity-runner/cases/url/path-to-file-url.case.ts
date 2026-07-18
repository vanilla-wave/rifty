import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  cwd: '/app',
  code: `
    const { fileURLToPath, pathToFileURL } = require('node:url');
    const absolute = '/a b/#q?/%2F/ü';
    const absoluteUrl = pathToFileURL(absolute);
    console.log(absoluteUrl.href);
    console.log(fileURLToPath(absoluteUrl) === absolute);

    const relative = 'nested #?% ü/';
    const relativeUrl = pathToFileURL(relative);
    console.log(relativeUrl.href.endsWith('/app/nested%20%23%3F%25%20%C3%BC/'));
    console.log(fileURLToPath(relativeUrl).endsWith('/app/nested #?% ü/'));

    console.log(pathToFileURL('/back\\\\slash').href);
    console.log(pathToFileURL('/a//x/../~\\\\b/').href);
    console.log(pathToFileURL('/bad-' + String.fromCharCode(0xd800)).href);
    console.log(fileURLToPath('file:///a%5Cb'));
    for (const value of [
      'file:///a%2Fb',
      'file://host/a',
      'https://example.test/a',
      'file://host/a%2Fb',
    ]) {
      try {
        fileURLToPath(value);
      } catch (error) {
        console.log(error.code);
      }
    }
  `,
  expected: [
    'file:///a%20b/%23q%3F/%252F/%C3%BC',
    'true',
    'true',
    'true',
    'file:///back%5Cslash',
    'file:///a/%7E%5Cb/',
    'file:///bad-%EF%BF%BD',
    '/a\\b',
    'ERR_INVALID_FILE_URL_PATH',
    'ERR_INVALID_FILE_URL_HOST',
    'ERR_INVALID_URL_SCHEME',
    'ERR_INVALID_FILE_URL_HOST',
    '',
  ].join('\n'),
};

export default c;
