// node docx.cjs <out>: heading, paragraphs with runs, a table and an image.
const fs = require('node:fs');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  ImageRun,
} = require('docx');
const out = process.argv[2];
const cell = (t) => new TableCell({ children: [new Paragraph(t)] });
const doc = new Document({
  creator: 'probe',
  title: 'Probe document',
  sections: [
    {
      children: [
        new Paragraph({ text: 'Quarterly report', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [new TextRun('Revenue grew '), new TextRun({ text: '12%', bold: true })],
        }),
        new Table({
          rows: [
            new TableRow({ children: [cell('Region'), cell('Revenue')] }),
            new TableRow({ children: [cell('North'), cell('120')] }),
          ],
        }),
        new Paragraph({
          children: [
            new ImageRun({
              type: 'png',
              data: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
                'base64',
              ),
              transformation: { width: 20, height: 20 },
            }),
          ],
        }),
      ],
    },
  ],
});
Packer.toBuffer(doc)
  .then((buf) => {
    fs.writeFileSync(out, buf);
    console.log('wrote', out);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
