const fs = require('node:fs');
const vals = {
  123: 123,
  null: null,
  undefined: undefined,
  '[]': [],
  '[1,2,3]': [1, 2, 3],
  '{}': {},
  'toString obj': {
    toString() {
      return 'ts';
    },
  },
  ArrayBuffer: new ArrayBuffer(3),
  SharedArrayBuffer: new SharedArrayBuffer(3),
  'new String': new String('s'),
};
const desc = (e) => `${e.name} ${e.code} ${e.message}`;
const size = (p) => {
  try {
    return fs.statSync(p).size;
  } catch (e) {
    return e.code;
  }
};
let n = 0;
const sync = {
  writeFileSync: (p, v) => fs.writeFileSync(p, v),
  appendFileSync: (p, v) => fs.appendFileSync(p, v),
  'writeFileSync r+': (p, v) => {
    fs.writeFileSync(p, 'zz');
    fs.writeFileSync(p, v, { flag: 'r+' });
  },
  writeSync: (p, v) => {
    const fd = fs.openSync(p, 'w');
    try {
      fs.writeSync(fd, v);
    } finally {
      fs.closeSync(fd);
    }
  },
};
const asyncs = {
  writeFile: (p, v, cb) => fs.writeFile(p, v, cb),
  appendFile: (p, v, cb) => fs.appendFile(p, v, cb),
  write: (p, v, cb) => {
    const fd = fs.openSync(p, 'w');
    fs.write(fd, v, (e) => {
      fs.closeSync(fd);
      cb(e);
    });
  },
  'promises.writeFile': (p, v, cb) => fs.promises.writeFile(p, v).then(() => cb(null), cb),
  'promises.appendFile': (p, v, cb) => fs.promises.appendFile(p, v).then(() => cb(null), cb),
};
(async () => {
  for (const [vn, v] of Object.entries(vals)) {
    for (const [en, f] of Object.entries(sync)) {
      const p = `f${n++}`;
      try {
        f(p, v);
        console.log(en, vn, 'ok size', size(p));
      } catch (e) {
        console.log(en, vn, 'throws', desc(e), 'size', size(p));
      }
    }
    for (const [en, f] of Object.entries(asyncs)) {
      const p = `f${n++}`;
      await new Promise((res) => {
        try {
          f(p, v, (e) => {
            console.log(en, vn, e ? `cb err ${desc(e)}` : 'ok', 'size', size(p));
            res();
          });
        } catch (e) {
          console.log(en, vn, 'throws', desc(e), 'size', size(p));
          res();
        }
      });
    }
  }
})();
