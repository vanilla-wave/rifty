export interface ScriptedCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export type ScriptedReply = string | readonly ScriptedCall[] | { readonly error: string };

export interface ProviderRequest {
  readonly authorization: string | null;
  readonly body: {
    readonly messages: readonly Record<string, unknown>[];
    readonly tools: readonly { readonly function: { readonly name: string } }[];
  };
}

/** The only fake boundary: an OpenAI-compatible streaming model response. */
export function scriptedProvider(replies: readonly ScriptedReply[]) {
  const requests: ProviderRequest[] = [];
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = await request.json();
    requests.push({ authorization: request.headers.get('authorization'), body });
    const index = requests.length - 1;
    const reply = replies[index];
    if (reply === undefined) throw new Error(`Unexpected model request ${index}`);
    if (typeof reply === 'object' && 'error' in reply) {
      return Response.json({ error: { message: reply.error } }, { status: 503 });
    }
    const base = {
      id: `completion-${index}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'scripted',
    };
    const delta =
      typeof reply === 'string'
        ? { content: reply }
        : {
            tool_calls: reply.map((call, offset) => ({
              index: offset,
              id: `call-${index}-${offset}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          };
    const chunks = [
      { ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
      {
        ...base,
        choices: [
          { index: 0, delta: {}, finish_reason: typeof reply === 'string' ? 'stop' : 'tool_calls' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
      },
    ];
    return new Response(
      `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
      {
        headers: { 'content-type': 'text/event-stream' },
      },
    );
  };
  return { requests, fetch: transport };
}
