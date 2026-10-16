// Runs workflow discovery through the production loader (`node --import tsx`), whose esbuild
// transform wraps named functions with a `__name` helper that a serialized evaluate callback
// cannot reach inside the browser. Exit 1 on any mismatch.
import { chromium } from '@playwright/test';
import { workflowCandidates } from '../../src/judge/context.ts';

const flat =
  '<section aria-label="Rooms"><h2>Rooms</h2><label>Room name<input value="Cancel"></label><button data-target="cancellation">Cancel room edit</button><ul><li><span>Cancel</span><button data-target="record">Cancel room edit</button><button data-target="record">Cancel room edit</button><button>Delete room Cancel</button></li></ul></section>';
const nested =
  '<section aria-label="Rooms"><h2>Rooms</h2><label>Room name<input value="Cancel"></label><button data-target="cancellation">Cancel room edit</button><ul><li><div><span>Cancel</span><button>Delete room Cancel</button></div><button data-target="record">Cancel room edit</button><button data-target="record">Cancel room edit</button></li></ul></section>';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [label, html] of [
    ['flat', flat],
    ['nested', nested],
  ] as const) {
    await page.setContent(html);
    const candidates = await workflowCandidates(
      { view: page, previewUrl: 'about:blank' },
      'edit',
      'room',
    );
    const targets = await candidates.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-target')),
    );
    if (targets.filter((target) => target === 'record').length !== 2) {
      console.error(`${label}: expected both record aliases, got ${JSON.stringify(targets)}`);
      process.exit(1);
    }
    console.log(`${label}: ok`);
  }
} finally {
  await browser.close();
}
