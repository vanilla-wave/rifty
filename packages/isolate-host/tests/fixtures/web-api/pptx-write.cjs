// Goal isolate-guest-web-api, scenario step 1: `pptx.write()` (no outputType) gives a Blob.
const fs = require('node:fs');
const PptxGenJS = require('pptxgenjs');
const pptx = new PptxGenJS();
pptx.addSlide().addText('Hi', { x: 1, y: 1 });
pptx
  .write()
  .then(async (blob) => {
    console.log(Object.prototype.toString.call(blob), blob.constructor.name);
    const buf = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(process.argv[2], buf);
    console.log('bytes', buf.length > 1000);
  })
  .catch((e) => {
    console.error(e?.stack ?? e);
    process.exitCode = 1;
  });
