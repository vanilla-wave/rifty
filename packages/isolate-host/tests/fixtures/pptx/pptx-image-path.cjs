// node pptx-image-path.cjs <out>: a slide with an image read by pptxgenjs from `dot.png` (cwd).
const PptxGenJS = require('pptxgenjs');
const out = process.argv[2];
const pptx = new PptxGenJS();
pptx.title = 'Image by path';
pptx.addSlide().addImage({ path: 'dot.png', x: 1, y: 1, w: 1, h: 1 });
pptx
  .writeFile({ fileName: out })
  .then((name) => console.log('wrote', name))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
