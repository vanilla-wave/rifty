// S1: does a listener survive a guest listener that called stopImmediatePropagation() first?
// (1) a listener on a dependent signal from AbortSignal.any([s]); (2) a capture listener on s added later;
// (3) the same with the guest listener also capture. Real Node v24's EventTarget and Chromium 148's.
// usage: node abort-semantics.mjs
import { chromium } from '@playwright/test';

const probe = () => {
  const out = {};
  const run = (name, guestCapture, mk) => {
    const ac = new AbortController();
    ac.signal.addEventListener('abort', (e) => e.stopImmediatePropagation(), {
      capture: guestCapture,
    });
    let hit = false;
    mk(ac.signal, () => {
      hit = true;
    });
    ac.abort();
    out[name] = hit;
  };
  out.anyExists = typeof AbortSignal.any === 'function';
  if (out.anyExists)
    run('dependent AbortSignal.any', false, (s, f) =>
      AbortSignal.any([s]).addEventListener('abort', f, { once: true }),
    );
  run('capture listener, guest bubble', false, (s, f) =>
    s.addEventListener('abort', f, { once: true, capture: true }),
  );
  run('capture listener, guest capture', true, (s, f) =>
    s.addEventListener('abort', f, { once: true, capture: true }),
  );
  run('plain listener (today)', false, (s, f) => s.addEventListener('abort', f, { once: true }));
  return out;
};
console.log(`node ${process.version}: ${JSON.stringify(probe())}`);
const browser = await chromium.launch();
const page = await browser.newPage();
console.log(`chromium ${browser.version()}: ${JSON.stringify(await page.evaluate(probe))}`);
await browser.close();
