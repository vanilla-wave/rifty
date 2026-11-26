// Goal isolate-guest-web-api, scenario step 2: `Packer.toBlob(doc)` gives a Blob.
const fs = require('node:fs');
const { Document, Packer, Paragraph } = require('docx');
const doc = new Document({ sections: [{ children: [new Paragraph('Hello')] }] });
Packer.toBlob(doc)
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
