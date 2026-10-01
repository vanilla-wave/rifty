const { fork } = require('node:child_process');
if (process.argv[2] === 'child') {
  process.on('message', (m) => {
    console.log('BUFFER', Buffer.isBuffer(m.b), 'BYTE', m.b[0]);
    process.exit(0);
  });
} else {
  let count = 0;
  const child = fork(__filename, ['child'], { serialization: 'advanced' });
  child.send({
    get b() {
      count++;
      return Buffer.from([count]);
    },
  });
  console.log('GETS', count);
}
