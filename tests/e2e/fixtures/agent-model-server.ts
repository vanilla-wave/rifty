import { type ServerResponse, createServer } from 'node:http';
import {
  type ScriptedReply,
  scriptedProvider,
} from '../../integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';

/** Only the external model is scripted. Real Pi, project files, terminal and preview run normally. */
export async function agentModelServer(initial: readonly ScriptedReply[]) {
  const replies = [...initial];
  const provider = scriptedProvider(replies);
  let release: (() => void) | undefined;
  let holdText: string | undefined;
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader(
      'Access-Control-Allow-Headers',
      request.headers['access-control-request-headers'] ?? '*',
    );
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = new Request('https://scripted.invalid/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(request.headers.authorization
            ? { Authorization: request.headers.authorization }
            : {}),
        },
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const result = await provider.fetch(input);
      response.writeHead(result.status, {
        'Content-Type': result.headers.get('content-type') ?? 'text/plain',
      });
      const body = await result.text();
      if (holdText && body.includes(holdText)) {
        await writeHeld(response, body);
      } else response.end(body);
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  async function writeHeld(response: ServerResponse, body: string) {
    const parts = body.split('\n\n');
    response.write(`${parts.slice(0, 2).join('\n\n')}\n\n`);
    await new Promise<void>((resolve) => {
      release = resolve;
      response.once('close', resolve);
    });
    holdText = undefined;
    release = undefined;
    response.end(parts.slice(2).join('\n\n'));
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Model did not bind loopback');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests: provider.requests,
    append: (...next: ScriptedReply[]) => replies.push(...next),
    holdFinal(text: string) {
      holdText = text;
    },
    releaseFinal() {
      release?.();
    },
    async close() {
      release?.();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
