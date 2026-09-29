import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:5615';
async function call(path, method, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const response = await r.json();
  if (response.value?.error) throw new Error(JSON.stringify(response.value));
  return response.value;
}
const result = {
  run: `native-safari-${new Date().toISOString()}`,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  platform: 'macOS native Safari WebDriver',
  result: 'unknown',
};
let session;
try {
  const created = await call('/session', 'POST', {
    capabilities: { alwaysMatch: { browserName: 'safari' } },
  });
  session = created.sessionId;
  result.capabilities = created.capabilities;
  const command = (path, body) => call(`/session/${session}${path}`, 'POST', body);
  await command('/url', { url: 'http://127.0.0.1:5611/browser-support.html' });
  const script = (source) => command('/execute/sync', { script: source, args: [] });
  const until = Date.now() + 300000;
  while (Date.now() < until) {
    const state = await script(
      'return {ready:document.documentElement.dataset.harness,result:document.documentElement.dataset.result};',
    );
    if (state.ready === 'ready' || state.result === 'fail') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if ((await script('return document.documentElement.dataset.result')) !== 'fail') {
    const element = await command('/element', { using: 'css selector', value: '#start' });
    await command(`/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
  }
  while (Date.now() < until) {
    try {
      const state = await script(
        'return {result:document.documentElement.dataset.result,text:document.querySelector("#report")?.value};',
      );
      if (['pass', 'fail'].includes(state.result)) {
        result.report = JSON.parse(state.text);
        result.result = state.result;
        break;
      }
    } catch (error) {
      result.lastPollError = error.message;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (result.result === 'unknown') result.reason = 'Protocol did not settle within 300 seconds';
} catch (error) {
  result.reason = error.message;
} finally {
  if (session)
    await call(`/session/${session}`, 'DELETE').catch((error) => {
      result.cleanup = error.message;
    });
  await writeFile('/tmp/pr362-native-safari-result.json', `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify({
      result: result.result,
      reason: result.reason,
      capabilities: result.capabilities,
      steps: result.report?.steps.map((x) => ({ step: x.step, status: x.status, error: x.error })),
    }),
  );
}
