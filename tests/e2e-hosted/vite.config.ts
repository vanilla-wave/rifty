import { readFileSync } from 'node:fs';
import playgroundConfig from '../../apps/playground/vite.config.ts';

const port = Number(process.env.RIFTY_PLAYGROUND_PORT ?? 5376);

/** Test-only outer host. The guest webpack config remains the unit under test. */
export default {
  ...playgroundConfig,
  server: {
    ...playgroundConfig.server,
    host: '127.0.0.1',
    port,
    strictPort: true,
    allowedHosts: ['hosted.rifty.test'],
    https: {
      cert: readFileSync(new URL('./fixtures/hosted.rifty.test-cert.pem', import.meta.url)),
      key: readFileSync(new URL('./fixtures/hosted.rifty.test-key.pem', import.meta.url)),
    },
  },
};
