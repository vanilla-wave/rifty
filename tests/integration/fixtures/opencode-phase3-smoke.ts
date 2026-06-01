/**
 * opencode PHASE-3 LLM round-trip smoke — standalone (run via `tsx`), NOT a
 * vitest test. Takes the booted server (same realm as the BOOT/DB-READ gates —
 * see `opencode-vfs-harness.ts`) and drives ONE real LLM round-trip against an
 * OpenAI-COMPATIBLE endpoint: create a session, send a text prompt, assert a
 * non-empty assistant text reply.
 *
 * The C1 pre-flight (decisions.md ADR-0061 "C1 PRE-FLIGHT RESULT") established
 * that the `ai`/`@ai-sdk` path issues requests via `globalThis.fetch` with no
 * `node:https`/`https.Agent` touch — so this works with `node:https` left as a
 * loud-throw facade; the outbound HTTPS is real (Node's global `fetch`).
 *
 * Provider wiring (verified against opencode @ pinned SHA): opencode's
 * `BUNDLED_PROVIDERS["@ai-sdk/openai-compatible"]` → `createOpenAICompatible`
 * (now KEEP-installed in `deps`, see fetch-opencode.mjs). The provider +
 * baseURL + apiKey + one model are supplied entirely via `OPENCODE_CONFIG_CONTENT`
 * (so `OPENCODE_DISABLE_MODELS_FETCH=1` avoids any models.dev network).
 *
 * Credentials come from the REAL env (this is a spend + an external call —
 * provided by the operator, never hardcoded, D-004). REQUIRED:
 *   RIFTY_OC_BASE_URL   OpenAI-compatible base URL (e.g. https://host/v1)
 *   RIFTY_OC_API_KEY    API key for that endpoint
 *   RIFTY_OC_MODEL      model id at that endpoint (e.g. gpt-4o-mini)
 * OPTIONAL:
 *   RIFTY_OC_PROVIDER   provider id used in the model ref (default: oai-compat)
 *   RIFTY_OC_PROMPT     the prompt (default: a one-word reply request)
 *
 * Run directly (sandbox disabled — needs the 217MB deps + network to the endpoint):
 *   RIFTY_OC_BASE_URL=… RIFTY_OC_API_KEY=… RIFTY_OC_MODEL=… \
 *     npx tsx tests/integration/fixtures/opencode-phase3-smoke.ts
 *
 * Prints exactly one terminal marker line and exits:
 *   RIFTY_OPENCODE_LLM_OK  (exit 0)  — round-trip returned non-empty assistant text
 *   RIFTY_OPENCODE_LLM_BLOCKED <reason>  (exit 4) — missing creds OR a real wall
 */
import { dispatchToPort } from '../../../packages/net/src/registry.ts';
import {
  ENTRY,
  ROOT,
  buildOpencodeLoader,
  installSafetyTimeout,
  makeLog,
  realExit,
  reportBlocked,
} from './opencode-vfs-harness.ts';

// biome-ignore lint/suspicious/noExplicitAny: smoke harness.
type Any = any;

const log = makeLog('opencode-llm');
installSafetyTimeout(log);

// Read operator-supplied creds from the REAL env (before the harness swaps
// globalThis.process.env). Never hardcoded (D-004).
const BASE_URL = process.env.RIFTY_OC_BASE_URL;
const API_KEY = process.env.RIFTY_OC_API_KEY;
const MODEL_ID = process.env.RIFTY_OC_MODEL;
const PROVIDER_ID = process.env.RIFTY_OC_PROVIDER ?? 'oai-compat';
const PROMPT = process.env.RIFTY_OC_PROMPT ?? 'Reply with exactly one word: pong';

interface Listener {
  hostname: string;
  port: number;
  url: URL;
  stop: (close?: boolean) => Promise<void>;
}

async function post(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const res = await dispatchToPort(
    port,
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, text: await res.text() };
}

/** Pull the first assistant text out of opencode's message-with-parts reply. */
function extractAssistantText(json: Any): string {
  const parts: Any[] = json?.parts ?? json?.info?.parts ?? [];
  const texts = (Array.isArray(parts) ? parts : [])
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string);
  return texts.join('').trim();
}

async function main(): Promise<void> {
  if (!BASE_URL || !API_KEY || !MODEL_ID) {
    // Not a wall — no creds provided. Skip-with-reason (CI-safe), same convention.
    throw new Error('missing creds — set RIFTY_OC_BASE_URL, RIFTY_OC_API_KEY, RIFTY_OC_MODEL');
  }

  const loader = await buildOpencodeLoader(log);

  // Supply the OpenAI-compatible provider + model entirely via config, and
  // disable the models.dev network fetch. Set AFTER buildOpencodeLoader (which
  // overwrote globalThis.process.env) and BEFORE importing the graph, so
  // opencode's Flag/config reads observe them.
  const config = {
    provider: {
      [PROVIDER_ID]: {
        npm: '@ai-sdk/openai-compatible',
        name: 'OpenAI-compatible (rifty Phase-3)',
        options: { baseURL: BASE_URL, apiKey: API_KEY },
        models: { [MODEL_ID]: { name: MODEL_ID } },
      },
    },
  };
  (globalThis as Any).process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
  (globalThis as Any).process.env.OPENCODE_DISABLE_MODELS_FETCH = '1';
  log(`config: provider=${PROVIDER_ID} model=${MODEL_ID} baseURL=${BASE_URL}`);

  log(`importing programmatic entry: ${ENTRY} ...`);
  const ns = (await loader.import(ENTRY, `${ROOT}/__entry__.mjs`)) as Any;
  const Server = ns.Server;
  if (!Server || typeof Server.listen !== 'function') {
    throw new Error(`Server.listen unavailable (Server is ${typeof Server})`);
  }

  log('calling Server.listen({ port: 4096, hostname: 127.0.0.1, mdns: false }) ...');
  const listener = (await Server.listen({
    port: 4096,
    hostname: '127.0.0.1',
    mdns: false,
  })) as Listener;
  log(`BOOTED — listening at ${listener.url} (port ${listener.port})`);

  // 1) Create a session.
  log('POST /session ...');
  const created = await post(listener.port, '/session', {});
  log(`POST /session -> ${created.status}: ${created.text.slice(0, 200)}`);
  if (created.status !== 200) {
    throw new Error(`session create returned ${created.status}: ${created.text.slice(0, 300)}`);
  }
  const sessionID = (JSON.parse(created.text) as { id?: string }).id;
  if (!sessionID) throw new Error(`session create 200 but no id: ${created.text.slice(0, 200)}`);
  log(`session id = ${sessionID}`);

  // 2) Send one prompt → one LLM round-trip. The HTTP `model` field is a
  // ModelRef object `{ providerID, modelID }` (prompt.ts:1681), NOT a string.
  log(`POST /session/${sessionID}/message  model=${PROVIDER_ID}/${MODEL_ID} ...`);
  const replied = await post(listener.port, `/session/${sessionID}/message`, {
    model: { providerID: PROVIDER_ID, modelID: MODEL_ID },
    parts: [{ type: 'text', text: PROMPT }],
  });
  const snippet = replied.text.slice(0, 600).replace(/\n/g, ' ');
  log(`POST .../message -> ${replied.status} (${replied.text.length} bytes): ${snippet}`);

  await listener.stop(true).catch((e) => log(`listener.stop failed (ignored): ${String(e)}`));

  if (replied.status !== 200) {
    throw new Error(`prompt returned ${replied.status}, expected 200: ${snippet}`);
  }
  const text = extractAssistantText(JSON.parse(replied.text));
  log(`assistant text (${text.length} chars): ${JSON.stringify(text.slice(0, 200))}`);
  if (!text) {
    throw new Error(`prompt 200 but no assistant text in reply: ${snippet}`);
  }
  log('RIFTY_OPENCODE_LLM_OK');
  realExit(0);
}

main().catch((e) => reportBlocked(log, 'RIFTY_OPENCODE_LLM_BLOCKED', e));
