// pptx.cjs over the browser bundle (dist/pptxgen.bundle.js: JSZip inside, no import()); it is a
// script declaring var PptxGenJS, not a module, so it is evaluated by path, not require()d.
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(path.dirname(require.resolve('pptxgenjs')), 'pptxgen.bundle.js');
const PptxGenJS = new Function(
  'module',
  'exports',
  'define',
  `${fs.readFileSync(file, 'utf8')};return PptxGenJS;`,
)();
const out = process.argv[2];
const pptx = new PptxGenJS();
pptx.title = 'Probe deck';
const s1 = pptx.addSlide();
s1.addText('Quarterly report', { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 32, bold: true });
s1.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.6, w: 4, h: 0.2, fill: { color: 'FF0000' } });
s1.addImage({
  data: 'image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  x: 6,
  y: 2,
  w: 1,
  h: 1,
});
const s2 = pptx.addSlide();
s2.addTable(
  [
    [{ text: 'Region' }, { text: 'Revenue' }],
    ['North', '120'],
    ['South', '95'],
  ],
  { x: 0.5, y: 0.5, w: 6 },
);
const s3 = pptx.addSlide();
s3.addChart(
  pptx.ChartType.bar,
  [{ name: 'Revenue', labels: ['Q1', 'Q2', 'Q3'], values: [10, 20, 15] }],
  { x: 0.5, y: 0.5, w: 8, h: 4 },
);
pptx
  .write({ outputType: 'nodebuffer' })
  .then((buf) => {
    fs.writeFileSync(out, buf);
    console.log('wrote', out);
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
