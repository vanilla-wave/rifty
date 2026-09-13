import { createServer } from 'node:http';
import {
  type ProviderRequest,
  scriptedProvider,
} from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';

/** Independent external boundary observer; task programs and judges are never mocked. */
export async function observedSmokeModel() {
  const requests: ProviderRequest[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (request.method === 'OPTIONS') return void response.end();
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProviderRequest['body'];
      const finished = body.messages.some((message) => message.role === 'tool');
      const read = body.tools.some((tool) => tool.function.name === 'read_file')
        ? 'read_file'
        : 'read';
      const provider = scriptedProvider([
        finished
          ? 'Smoke complete; task remains unchanged.'
          : [{ name: read, args: { path: 'package.json' } }],
      ]);
      const result = await provider.fetch(
        new Request('https://scripted.invalid/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(request.headers.authorization
              ? { Authorization: request.headers.authorization }
              : {}),
          },
          body: JSON.stringify(body),
        }),
      );
      requests.push(...provider.requests);
      response.writeHead(result.status, {
        'Content-Type': result.headers.get('content-type') ?? 'text/plain',
      });
      response.end(await result.text());
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Smoke provider did not bind');
  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
