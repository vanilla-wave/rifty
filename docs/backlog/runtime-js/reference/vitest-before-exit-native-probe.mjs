console.log(process.version);
process.once('beforeExit', (code) => console.log('BEFORE-EXIT', code));
process.once('exit', (code) => console.log('EXIT', code));
