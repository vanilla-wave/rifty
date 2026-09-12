import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';

const model = { id: 'pi-probe', name: 'Pi probe', api: 'openai-completions', provider: 'probe', baseUrl: 'http://localhost:9/v1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 1024 };
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const copy = (value) => JSON.parse(JSON.stringify(value));
const assert = (value, message) => { if (!value) throw new Error(message); };
const text = (value) => [{ type: 'text', text: value }];
const user = (value) => ({ role: 'user', content: text(value), timestamp: Date.now() });
const call = (id, name = 'write_action', args = { text: 'written' }) => ({ type: 'toolCall', id, name, arguments: args });
const assistant = (content, stopReason = 'stop', errorMessage) => ({ role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage: copy(usage), stopReason, ...(errorMessage ? { errorMessage } : {}), timestamp: Date.now() });
const response = (message) => {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'start', partial: message });
  if (message.stopReason === 'error' || message.stopReason === 'aborted') stream.push({ type: 'error', reason: message.stopReason, error: message });
  else stream.push({ type: 'done', reason: message.stopReason, message });
  return stream;
};
const compactMessage = (message) => ({ role: message.role, ...(message.stopReason ? { stopReason: message.stopReason } : {}), ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}), ...(message.toolCallId ? { toolCallId: message.toolCallId, isError: message.isError, details: message.details } : {}), content: message.content });
const tool = (execute, extras = {}) => ({ name: 'write_action', label: 'Write action', description: 'Append a line to the real probe file', parameters: Type.Object({ text: Type.String() }), execute, replay: 'never', ...extras });
const record = (agent) => { const events = []; agent.subscribe((event) => { events.push(copy(event)); }); return events; };

async function recovery(effects, via) {
  const requests = [];
  let writes = 0;
  const name = `custom-${via}`;
  const agent = new Agent({ initialState: { model, systemPrompt: 'Never repeat a completed write.', tools: [tool(async (id, params, signal, onUpdate) => { writes++; await effects.write(name, params.text); onUpdate?.({ content: text('write completed'), details: { phase: 'written' } }); return { content: text(`saved:${params.text}`), details: { outcome: 'committed', actionId: id } }; })] }, streamFn: (selected, context, options) => {
    requests.push(copy(context));
    if (requests.length === 1) return response(assistant([call('call_write')], 'toolUse'));
    if (requests.length === 2) return response(assistant([], 'error', 'deterministic provider failure after write'));
    assert(context.messages.some((m) => m.role === 'toolResult' && m.toolCallId === 'call_write' && !m.isError), 'continuation lost completed write');
    return response(assistant(text('Observed saved result; do not write again.')));
  } });
  const events = record(agent);
  await agent.prompt('Write once.');
  const afterError = agent.state.messages.map(compactMessage);
  let directContinueError;
  try { await agent.continue(); } catch (error) { directContinueError = error.message; }
  assert(directContinueError === 'Cannot continue from message role: assistant', 'expected explicit assistant-tail guard');
  assert(requests.length === 2, 'guard must not request provider');
  if (via === 'prompt') await agent.prompt('Continue from the completed action.');
  else { agent.followUp(user('Continue from the completed action.')); await agent.continue(); }
  assert(writes === 1, 'Pi replayed a completed action');
  assert(await effects.read(name) === 'written\n', 'real file contents mismatch');
  assert(requests.length === 3, 'unexpected provider call count');
  assert(!agent.state.isStreaming, 'agent did not become idle');
  return { writes, providerCalls: requests.length, directContinueError, afterError, continuationInput: requests[2].messages.map(compactMessage), traceHasUpdate: events.some((e) => e.type === 'tool_execution_update'), events: events.map((e) => e.type) };
}

async function abortTool(effects, preserveErrorDetails) {
  const requests = [];
  let activeSignal;
  let secondExecuted = false;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const active = tool(async (id, params, signal) => {
    activeSignal = signal;
    await effects.write(`abort-${preserveErrorDetails}`, 'started');
    started();
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    if (!preserveErrorDetails) throw new Error('command cancelled; worker replaced; outcome unknown');
    return { content: text('command cancelled; worker replaced; outcome unknown'), details: { outcome: 'cancelled', worker: 'replaced', effect: 'unknown' } };
  });
  const pending = { ...tool(async () => { secondExecuted = true; return { content: text('second'), details: {} }; }), name: 'pending_action' };
  const agent = new Agent({ initialState: { model, tools: [active, pending] }, toolExecution: 'sequential', ...(preserveErrorDetails ? { afterToolCall: async (context, signal) => signal?.aborted ? { isError: true } : undefined } : {}), streamFn: (selected, context, options) => {
    requests.push({ signalAborted: options.signal.aborted, context: copy(context) });
    if (options.signal.aborted) return response(assistant([], 'aborted', 'Operation aborted'));
    if (requests.length === 1) return response(assistant([call('call_active'), call('call_pending', 'pending_action')], 'toolUse'));
    return response(assistant(text('Continued after Stop.')));
  } });
  const events = record(agent);
  const run = agent.prompt('Run active command and then pending command.');
  await ready;
  assert(activeSignal === agent.signal, 'tool signal not identical to active Agent signal');
  agent.abort();
  await run;
  const afterAbort = agent.state.messages.map(compactMessage);
  assert(!secondExecuted, 'sequential pending tool executed after abort');
  assert(afterAbort.filter((m) => m.role === 'toolResult').length === 1, 'unexpected tool result count');
  assert(afterAbort.find((m) => m.toolCallId === 'call_active').isError, 'cancelled tool not marked error');
  assert(!afterAbort.some((m) => m.toolCallId === 'call_pending'), 'expected Pi raw history to omit skipped call result');
  const nextWire = await captureOpenAIWire([...agent.state.messages, user('Continue after Stop.')]);
  assert(nextWire.some((m) => m.role === 'tool' && m.tool_call_id === 'call_pending' && m.content === 'No result provided'), 'OpenAI did not synthesize missing pending result');
  await agent.prompt('Continue after Stop.');
  assert(requests.at(-1).signalAborted === false, 'next run reused aborted signal');
  return { preserveErrorDetails, requestsAfterAbort: requests.slice(0, 2).map((r) => ({ aborted: r.signalAborted })), afterAbort, nextWire, nextRunSignalAborted: requests.at(-1).signalAborted, events: events.map((e) => e.type) };
}

async function ignoresAbort() {
  let started;
  let finish;
  const ready = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { finish = resolve; });
  let requestCount = 0;
  const agent = new Agent({ initialState: { model, tools: [tool(async () => { started(); await pending; return { content: text('late success'), details: { outcome: 'committed' } }; })] }, streamFn: (selected, context, options) => {
    requestCount++;
    if (options.signal.aborted) return response(assistant([], 'aborted', 'Operation aborted'));
    return response(assistant([call('call_slow')], 'toolUse'));
  } });
  const run = agent.prompt('Run a tool that ignores cancellation.');
  await ready;
  agent.abort();
  await Promise.resolve();
  const streamingWhileToolPending = agent.state.isStreaming;
  assert(streamingWhileToolPending, 'abort unexpectedly settled an unresolved tool');
  finish();
  await run;
  const result = agent.state.messages.find((m) => m.role === 'toolResult');
  assert(result.isError === false, 'successful return after abort was marked error by Pi');
  return { streamingWhileToolPending, settledAfterToolReturned: !agent.state.isStreaming, lateToolResult: compactMessage(result), requestCount };
}

async function replayDeclaration(effects) {
  let writes = 0;
  let requests = 0;
  const agent = new Agent({ initialState: { model, tools: [tool(async () => { writes++; await effects.write('replay-never', 'action'); return { content: text('committed'), details: {} }; })] }, streamFn: () => {
    requests++;
    return response(requests < 3 ? assistant([call('same_call_id')], 'toolUse') : assistant(text('done')));
  } });
  await agent.prompt('Probe replay policy.');
  assert(writes === 2, 'unexpected enforcement of replay declaration');
  return { replay: 'never', identicalToolCallIdEmissions: 2, realWrites: writes, file: await effects.read('replay-never') };
}

const sse = (content, finishReason) => {
  const chunk = (delta, finish_reason) => ({ id: 'chatcmpl-probe', object: 'chat.completion.chunk', created: 1, model: model.id, choices: [{ index: 0, delta, finish_reason }] });
  return [chunk(content, null), chunk({}, finishReason)].map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join('') + 'data: [DONE]\n\n';
};
async function captureOpenAIWire(messages) {
  let wire;
  const stream = streamSimple(model, { messages }, { apiKey: 'unused-no-auth-sentinel', headers: { Authorization: null }, maxRetries: 0, fetch: async (input, init) => {
    wire = (await new Request(input, init).json()).messages;
    return new Response(sse({ role: 'assistant', content: 'done' }, 'stop'), { headers: { 'content-type': 'text/event-stream' } });
  } });
  const result = await stream.result();
  assert(result.stopReason === 'stop', 'OpenAI continuation serialization failed');
  return wire;
}

async function openAIRecovery(effects) {
  const requests = [];
  let writes = 0;
  const fakeFetch = async (input, init) => {
    const request = new Request(input, init);
    const body = await request.json();
    requests.push({ url: request.url, authorization: request.headers.get('authorization'), csrf: request.headers.get('x-csrf-token'), body });
    if (requests.length === 2) return new Response(JSON.stringify({ error: { message: 'provider failed after committed write', type: 'probe_failure' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    const bodyStream = requests.length === 1 ? sse({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_openai_write', type: 'function', function: { name: 'write_action', arguments: '{"text":"openai-written"}' } }] }, 'tool_calls') : sse({ role: 'assistant', content: 'Observed committed write; finished.' }, 'stop');
    return new Response(bodyStream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const agent = new Agent({ initialState: { model, systemPrompt: 'Integrator instructions', tools: [tool(async (id, params) => { writes++; await effects.write('openai-recovery', params.text); return { content: text('committed:openai-written'), details: { worker: 'retained' } }; })] }, streamFn: (selected, context, options) => streamSimple(selected, context, { ...options, fetch: fakeFetch, apiKey: 'unused-no-auth-sentinel', headers: { Authorization: null, 'X-CSRF-Token': 'probe-csrf' }, maxRetries: 0 }) });
  await agent.prompt('Write once.');
  assert(agent.state.messages.at(-1).stopReason === 'error', '503 not surfaced as assistant error');
  await agent.prompt('Continue.');
  assert(writes === 1, 'OpenAI provider recovery repeated write');
  assert(requests.length === 3, 'maxRetries zero not respected');
  assert(requests.every((request) => request.authorization === null), 'no-auth transport sent bearer');
  const finalMessages = requests[2].body.messages;
  assert(finalMessages.some((m) => m.role === 'tool' && m.tool_call_id === 'call_openai_write' && m.content.includes('committed')), 'wire request lost completed action');
  assert(finalMessages.every((m) => !JSON.stringify(m).includes('provider failed after committed write')), 'error leaked into OpenAI history');
  let noAuthError;
  try { streamSimple(model, { messages: [user('test')] }, { fetch: fakeFetch }); } catch (error) { noAuthError = error.message; }
  assert(noAuthError === 'No API key for provider: probe', 'unexpected no-auth API behavior');
  return { writes, noAuthError, requests, finalHistory: agent.state.messages.map(compactMessage) };
}

export async function runAll(effects) {
  return { customPrompt: await recovery(effects, 'prompt'), customFollowUp: await recovery(effects, 'followUp'), abortThrows: await abortTool(effects, false), abortStructured: await abortTool(effects, true), ignoresAbort: await ignoresAbort(), replayDeclaration: await replayDeclaration(effects), openAIRecovery: await openAIRecovery(effects) };
}
