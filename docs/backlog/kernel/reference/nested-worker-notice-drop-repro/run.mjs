// Counts parents still listed after page-side terminate(); see server.mjs.
import { chromium } from '@playwright/test';

const [port, iterations, variant] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/`);
let retained = 0;
for (let round = 0; round < Number(iterations); round += 1) {
  await page.evaluate(
    (name) =>
      new Promise((resolve) => {
        const parent = new Worker('parent.js', { name });
        parent.onmessage = () => {
          parent.terminate();
          resolve(undefined);
        };
        parent.postMessage('spawn');
      }),
    JSON.stringify({ variant, children: 1, busy: 5 }),
  );
  const deadline = Date.now() + 4_500;
  while (Date.now() < deadline && page.workers().length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (page.workers().length > 0) {
    retained += 1;
    await page.reload();
  }
}
console.log(`${variant}: retained ${retained}/${iterations}`);
await browser.close();
