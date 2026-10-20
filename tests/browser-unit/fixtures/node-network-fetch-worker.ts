import { fetchNodeNetwork } from '../../../packages/io/src/index.ts';
import { installFetchKeepalive } from '../../../packages/runtime-js/src/index.ts';
import { activeRefs } from '../../../packages/runtime-js/src/internal/index.ts';

installFetchKeepalive();
self.onmessage = async ({ data }: MessageEvent<{ url: string }>) => {
  try {
    const pending = fetchNodeNetwork(data.url, {
      method: 'POST',
      headers: { 'content-length': '5' },
      body: 'hello',
    });
    const held = activeRefs() > 0;
    const response = await pending;
    const text = await response.text();
    self.postMessage({ held, text, jsResponse: response instanceof Response, refs: activeRefs() });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
