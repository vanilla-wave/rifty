/**
 * Tiny OpenAI-compatible SSE server for `--mock-model` smoke runs: proves the
 * lane plumbing (models.json → pi CLI → tool execution → trace/report) without
 * spending model tokens. Scripted behavior per conversation:
 *   1st completion  → one `read package.json` tool call (finish_reason tool_calls)
 *   2nd completion  → short final text (finish_reason stop)
 * This mocks ONLY the external model endpoint (an unavoidable network boundary),
 * never rifty/pi code.
 */
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockModelServer {
  /** Base URL to put in models.json (includes /v1). */
  readonly baseUrl: string;
  readonly model: string;
  readonly envKey: string;
  close(): Promise<void>;
}

export const MOCK_MODEL_ID = 'agent-bench-mock';
export const MOCK_ENV_KEY = 'AGENT_BENCH_MOCK_API_KEY';

interface ChatMessage {
  role: string;
  [key: string]: unknown;
}

interface ChatRequest {
  messages?: ChatMessage[];
  tools?: { function?: { name?: string } }[];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sseChunk(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function chunkEnvelope(delta: unknown, finishReason: string | null): unknown {
  return {
    id: 'chatcmpl-agent-bench-mock',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MOCK_MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

const USAGE = { prompt_tokens: 24, completion_tokens: 8, total_tokens: 32 };

function respondToolCall(res: ServerResponse, toolName: string): void {
  sseChunk(res, chunkEnvelope({ role: 'assistant' }, null));
  sseChunk(
    res,
    chunkEnvelope(
      {
        tool_calls: [
          {
            index: 0,
            id: 'call_agent_bench_mock_1',
            type: 'function',
            function: { name: toolName, arguments: '' },
          },
        ],
      },
      null,
    ),
  );
  sseChunk(
    res,
    chunkEnvelope(
      { tool_calls: [{ index: 0, function: { arguments: '{"path":"package.json"}' } }] },
      null,
    ),
  );
  sseChunk(res, chunkEnvelope({}, 'tool_calls'));
  sseChunk(res, { ...(chunkEnvelope({}, null) as object), choices: [], usage: USAGE });
  res.write('data: [DONE]\n\n');
  res.end();
}

function respondFinalText(res: ServerResponse): void {
  sseChunk(res, chunkEnvelope({ role: 'assistant' }, null));
  sseChunk(res, chunkEnvelope({ content: 'Mock run complete: read package.json, done.' }, null));
  sseChunk(res, chunkEnvelope({}, 'stop'));
  sseChunk(res, { ...(chunkEnvelope({}, null) as object), choices: [], usage: USAGE });
  res.write('data: [DONE]\n\n');
  res.end();
}

/**
 * CORS for the rifty lane: the AI panel fetches this server cross-origin from
 * the playground page (localhost:<playgroundPort> → 127.0.0.1:<mockPort>).
 * Preflight echoes the requested headers (Authorization + x-stainless-* from
 * the openai client). The pi-CLI lane ignores all of this.
 */
function corsHeaders(req: IncomingMessage): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers':
      req.headers['access-control-request-headers'] ?? 'authorization, content-type',
    'access-control-max-age': '600',
  };
}

async function handleCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  let parsed: ChatRequest;
  try {
    parsed = JSON.parse(body) as ChatRequest;
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json', ...corsHeaders(req) });
    res.end(JSON.stringify({ error: `mock-model: invalid JSON body: ${(err as Error).message}` }));
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    ...corsHeaders(req),
  });
  const messages = parsed.messages ?? [];
  const sawToolResult = messages.some((m) => m.role === 'tool');
  // pi CLI offers `read`; the rifty AI mode offers `read_file` — same
  // scripted probe (read package.json) either way. Neither offered →
  // text-only reply (keeps the mock usable with a trimmed tool surface).
  const readToolName = ['read', 'read_file'].find((name) =>
    (parsed.tools ?? []).some((t) => t.function?.name === name),
  );
  if (sawToolResult || readToolName === undefined) respondFinalText(res);
  else respondToolCall(res, readToolName);
}

export function startMockModelServer(): Promise<MockModelServer> {
  const server: Server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...corsHeaders(req),
        ...(req.headers['access-control-request-private-network'] === 'true'
          ? { 'access-control-allow-private-network': 'true' }
          : {}),
      });
      res.end();
      return;
    }
    if (req.method === 'POST' && /\/chat\/completions$/.test(req.url ?? '')) {
      handleCompletion(req, res).catch((err: unknown) => {
        res.writeHead(500, { 'content-type': 'application/json', ...corsHeaders(req) });
        res.end(JSON.stringify({ error: String(err) }));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json', ...corsHeaders(req) });
    res.end(JSON.stringify({ error: `mock-model: no route ${req.method} ${req.url ?? '(none)'}` }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: MOCK_MODEL_ID,
        envKey: MOCK_ENV_KEY,
        close: () =>
          new Promise<void>((res2, rej2) => {
            server.close((err) => (err ? rej2(err) : res2()));
          }),
      });
    });
  });
}
