import type { Model } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import {
  type AgentSession,
  type AgentSessionEvent,
  type StreamFn,
  Type,
  createAgentSession,
  createBrowserAgentPreview,
  createWorkbenchAgentHost,
} from '../../../packages/agent/src/index.ts';
import { type ScriptedReply, scriptedProvider } from './agent-scripted-provider.ts';
import { currentProject, currentSessionTools } from './sealed-playground-workbench.ts';

const settings = {
  baseUrl: 'https://scripted.invalid/v1',
  model: 'scripted',
};

const scriptedModel: Model<'openai-completions'> = {
  id: settings.model,
  name: settings.model,
  api: 'openai-completions',
  provider: 'rifty',
  baseUrl: settings.baseUrl,
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8192,
};

async function file(path: string) {
  return new TextDecoder().decode((await currentProject().files.readFile(path)).bytes);
}

function setup(
  replies: readonly ScriptedReply[],
  maxToolCalls = 20,
  customStream = false,
  apiKey?: string,
) {
  const provider = scriptedProvider(replies);
  const events: AgentSessionEvent[] = [];
  const host = createWorkbenchAgentHost({ session: currentProject() });
  const streamFn: StreamFn = (_model, context, options) => {
    if (provider.requests.length > 0) {
      const callIds = context.messages.flatMap((message) =>
        message.role === 'assistant'
          ? message.content.filter((block) => block.type === 'toolCall').map((block) => block.id)
          : [],
      );
      const results = context.messages.filter((message) => message.role === 'toolResult');
      for (const id of callIds) {
        if (!results.some((result) => result.toolCallId === id))
          throw new Error(`Custom stream received dangling call ${id}`);
      }
    }
    return streamSimple(scriptedModel, context, {
      ...options,
      apiKey: 'unused',
      headers: { Authorization: null },
      fetch: provider.fetch,
      maxRetries: 0,
    });
  };
  const common = {
    host,
    maxToolCalls,
    runTimeoutMs: 20_000,
    instructions: ['Project instruction: preserve the existing file.'],
    tools: [
      {
        name: 'domain_status',
        label: 'Domain status',
        description: 'Read a domain record',
        parameters: Type.Object({}),
        async execute() {
          return {
            content: [{ type: 'text', text: 'The observed domain job failed.' }],
            details: { status: 'failed' },
          };
        },
      },
      {
        name: 'large_result',
        label: 'Large result',
        description: 'Consumer text-producing tool',
        parameters: Type.Object({}),
        async execute() {
          return {
            content: [{ type: 'text', text: `EXT_HEAD${'x'.repeat(20_000)}EXT_TAIL` }],
            details: { custom: true },
          };
        },
      },
      {
        name: 'deliver_note',
        label: 'Deliver note',
        description: 'Integrator-owned action',
        parameters: Type.Object({ text: Type.String() }),
        async execute(_id, params) {
          await currentProject().files.writeFile(
            '/delivered.txt',
            new TextEncoder().encode(params.text),
            { expectedVersion: null },
          );
          return {
            content: [{ type: 'text', text: 'delivered' }],
            details: { delivered: params.text },
          };
        },
      },
    ],
  };
  const session = createAgentSession(
    customStream
      ? { ...common, streamFn }
      : { ...common, settings: { ...settings, apiKey }, fetch: provider.fetch },
  );
  session.subscribe((event) => events.push(event));
  return { session, provider, events };
}

export async function proveTools() {
  const { session, provider, events } = setup([
    [{ name: 'write_file', args: { path: 'agent.txt', content: 'agent-content' } }],
    [{ name: 'shell', args: { command: 'cat agent.txt' } }],
    [{ name: 'deliver_note', args: { text: 'custom-action' } }],
    'Finished.',
  ]);
  let completedTrace: ReturnType<AgentSession['exportTrace']> | undefined;
  session.subscribe((event) => {
    if (event.type === 'status' && event.status === 'done') completedTrace = session.exportTrace();
  });
  try {
    await session.send('Write, run and deliver.');
    return {
      status: session.status(),
      file: await file('/agent.txt'),
      delivered: await file('/delivered.txt'),
      requests: provider.requests,
      events,
      trace: await session.exportTrace(),
      completedTrace: await completedTrace,
    };
  } finally {
    await session.dispose();
  }
}

export async function proveRecovery() {
  const { session, provider } = setup([
    [{ name: 'write_file', args: { path: 'once.txt', content: 'committed-once' } }],
    { error: 'provider failed after write' },
    [{ name: 'shell', args: { command: 'cat once.txt' } }],
    'Continued without repeating the write.',
  ]);
  try {
    await session.send('Write once.');
    const failedStatus = session.status();
    const failedTrace = await session.exportTrace();
    await session.send('Continue from completed work.');
    return {
      failedStatus,
      failedTrace,
      status: session.status(),
      file: await file('/once.txt'),
      requests: provider.requests,
      trace: await session.exportTrace(),
    };
  } finally {
    await session.dispose();
  }
}

export async function proveStop(customStream = false) {
  const { session, provider, events } = setup(
    [
      [
        {
          name: 'shell',
          args: {
            command: 'node -e "console.log(\'AGENT_STARTED\'); setInterval(() => {}, 1000)"',
          },
        },
        { name: 'write_file', args: { path: 'must-not-run.txt', content: 'wrong' } },
      ],
      [{ name: 'shell', args: { command: 'echo NEXT_COMMAND' } }],
      'Next command completed.',
    ],
    20,
    customStream,
  );
  let stop: Promise<void> | undefined;
  session.subscribe((event) => {
    if (event.type === 'output' && event.chunk.includes('AGENT_STARTED')) stop ??= session.stop();
  });
  try {
    await session.send('Run until stopped.');
    await stop;
    const stoppedStatus = session.status();
    const stoppedTrace = await session.exportTrace();
    await session.send('Run the next command.');
    const paths = (await currentProject().files.readdir('/')).map((entry) => entry.path);
    return {
      stoppedStatus,
      stoppedTrace,
      status: session.status(),
      paths,
      requests: provider.requests,
      events,
    };
  } finally {
    await session.dispose();
  }
}

export async function proveBudget() {
  const { session } = setup(
    [
      [
        { name: 'write_file', args: { path: 'allowed.txt', content: 'one' } },
        { name: 'write_file', args: { path: 'over-budget.txt', content: 'two' } },
      ],
    ],
    1,
  );
  try {
    await session.send('Do both writes.');
    return {
      status: session.status(),
      paths: (await currentProject().files.readdir('/')).map((entry) => entry.path),
      trace: await session.exportTrace(),
    };
  } finally {
    await session.dispose();
  }
}

export async function proveFileTools() {
  await currentProject().files.writeFile(
    '/ambiguous.txt',
    new TextEncoder().encode('repeat repeat'),
    { expectedVersion: null },
  );
  const { session } = setup([
    [{ name: 'write_file', args: { path: 'nested/source.txt', content: 'alpha\nbeta\n' } }],
    [{ name: 'edit_file', args: { path: 'nested/source.txt', old: 'missing', new: 'wrong' } }],
    [{ name: 'edit_file', args: { path: 'nested/source.txt', old: 'beta', new: 'gamma' } }],
    [{ name: 'grep', args: { pattern: 'gamma', path: 'nested' } }],
    [{ name: 'glob', args: { pattern: '**/*.txt' } }],
    [{ name: 'list_files', args: { path: 'nested' } }],
    [
      {
        name: 'apply_patch',
        args: {
          patch:
            '--- a/nested/source.txt\n+++ b/nested/source.txt\n@@ -1,2 +1,2 @@\n alpha\n-gamma\n+delta\n',
        },
      },
    ],
    [{ name: 'read_file', args: { path: 'nested/source.txt' } }],
    [{ name: 'edit_file', args: { path: 'ambiguous.txt', old: 'repeat', new: 'wrong' } }],
    [
      {
        name: 'apply_patch',
        args: {
          patch:
            '--- a/nested/source.txt\n+++ b/nested/source.txt\n@@ -1,2 +1,2 @@\n wrong-context\n-delta\n+wrong\n',
        },
      },
    ],
    'Finished.',
  ]);
  try {
    await session.send('Edit exactly, search and patch.');
    return {
      status: session.status(),
      file: await file('/nested/source.txt'),
      trace: await session.exportTrace(),
    };
  } finally {
    await session.dispose();
  }
}

export type ProofSession = AgentSession;

export async function proveCompanion() {
  const project = currentProject();
  const companion = currentSessionTools();
  await project.files.writeFile(
    '/diagnostic.ts',
    new TextEncoder().encode('const answer: number = "wrong";\n'),
    { expectedVersion: null },
  );
  await companion.typescript.open('/diagnostic.ts', await file('/diagnostic.ts'));
  const expectedDiagnostics = [
    ...(await companion.typescript.getSyntacticDiagnostics('/diagnostic.ts')),
    ...(await companion.typescript.getSemanticDiagnostics('/diagnostic.ts')),
  ];
  const provider = scriptedProvider([
    [{ name: 'diagnostics', args: { path: 'diagnostic.ts' } }],
    'Checked.',
  ]);
  const session = createAgentSession({
    host: createWorkbenchAgentHost({ session: project, companion }),
    settings,
    fetch: provider.fetch,
  });
  try {
    await session.send('Inspect diagnostics.');
    return { status: session.status(), expectedDiagnostics, trace: await session.exportTrace() };
  } finally {
    await session.dispose();
  }
}

export async function provePreview() {
  const frame = document.createElement('iframe');
  const loaded = new Promise<void>((resolve) => {
    frame.onload = () => resolve();
  });
  frame.srcdoc =
    '<input id="name"><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Apply</button><output>initial</output>';
  document.body.append(frame);
  await loaded;
  const preview = createBrowserAgentPreview({
    url: () => new URL('/unit-harness.html', location.href).href,
    frame: () => frame,
  });
  const host = createWorkbenchAgentHost({ session: currentProject(), preview: () => preview });
  const provider = scriptedProvider([
    [{ name: 'preview_fetch', args: { path: '' } }],
    [{ name: 'preview_type', args: { selector: '#name', text: 'changed' } }],
    [{ name: 'preview_click', args: { selector: 'button' } }],
    [{ name: 'preview_query', args: { selector: 'output' } }],
    'Checked.',
  ]);
  const session = createAgentSession({ host, settings, fetch: provider.fetch });
  try {
    await session.send('Check and interact with the host preview.');
    return {
      status: session.status(),
      output: frame.contentDocument?.querySelector('output')?.textContent,
      trace: await session.exportTrace(),
    };
  } finally {
    await session.dispose();
    frame.remove();
  }
}

export async function proveCap() {
  const text = `\ufeffHEAD${'é'.repeat(10_000)}TAIL`;
  await currentProject().files.writeFile('/large.txt', new TextEncoder().encode(text), {
    expectedVersion: null,
  });
  const { session } = setup([
    [{ name: 'read_file', args: { path: 'large.txt' } }],
    [{ name: 'large_result', args: {} }],
    'Read.',
  ]);
  try {
    await session.send('Read the file.');
    return { status: session.status(), trace: await session.exportTrace() };
  } finally {
    await session.dispose();
  }
}

export async function proveTimeBudget() {
  const host = createWorkbenchAgentHost({ session: currentProject() });
  let aborted = false;
  const session = createAgentSession({
    host,
    settings,
    runTimeoutMs: 100,
    fetch: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error('Provider signal absent'));
          return;
        }
        const onAbort = () => {
          aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }),
  });
  try {
    await session.send('Wait for provider.');
    return { status: session.status(), aborted };
  } finally {
    await session.dispose();
  }
}

export async function proveConcurrentEdit() {
  const project = currentProject();
  await project.files.writeFile('/concurrent.txt', new TextEncoder().encode('old'), {
    expectedVersion: null,
  });
  const prior = await project.files.readFile('/concurrent.txt');
  const host = createWorkbenchAgentHost({ session: project });
  let concurrent: Promise<unknown> | undefined;
  let failure: unknown;
  try {
    const files = host.capabilities().files;
    if (!files) throw new Error('Files capability missing');
    try {
      await files.change('/concurrent.txt', () => {
        concurrent = project.files.writeFile(
          '/concurrent.txt',
          new TextEncoder().encode('editor-change'),
          { expectedVersion: prior.version },
        );
        return 'stale-agent-change';
      });
    } catch (error) {
      failure = error;
    }
    await concurrent;
    return {
      file: await file('/concurrent.txt'),
      error: failure instanceof Error ? failure.name : String(failure),
    };
  } finally {
    await host.close();
  }
}

export async function proveKeyExport() {
  const key = 'synthetic-key-"quote"-\\slash';
  const { session, provider } = setup(['Reply without the key.'], 20, false, key);
  try {
    await session.send(`Synthetic input contains ${key}.`);
    return {
      trace: await session.exportTrace(),
      authorization: provider.requests[0]?.authorization,
      key,
    };
  } finally {
    await session.dispose();
  }
}

export async function proveShellParity() {
  const command = 'node -e "console.log(\'PARITY_OUTPUT\'); process.exit(7)"';
  const terminal = currentProject().terminals.open();
  let stdout = '';
  let stderr = '';
  const detach = terminal.attach((chunk, stream) => {
    if (stream === 'stdout') stdout += chunk;
    else stderr += chunk;
  });
  let exitCode: number;
  try {
    const run = terminal.run(command);
    exitCode = await run.exitCode;
    await run.close();
  } finally {
    detach();
    await terminal.close();
  }
  const { session } = setup([[{ name: 'shell', args: { command } }], 'Observed exit.']);
  try {
    await session.send('Run the command.');
    return { reference: { stdout, stderr, exitCode }, trace: await session.exportTrace() };
  } finally {
    await session.dispose();
  }
}

export async function proveDomainResult() {
  const { session } = setup([[{ name: 'domain_status', args: {} }], 'Observed.']);
  try {
    await session.send('Read the domain status.');
    return session.exportTrace();
  } finally {
    await session.dispose();
  }
}

export async function provePartialStreamStop() {
  const next = scriptedProvider(['Continued without executing the partial call.']);
  const unmatchedResults: string[] = [];
  let calls = 0;
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (calls++ === 0) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          request.signal.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ id: 'partial', object: 'chat.completion.chunk', model: 'scripted', created: 1, choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'partial-call', type: 'function', function: { name: 'write_file', arguments: '{"path":"partial.txt","content":' } }] } }] })}\n\n`,
            ),
          );
        },
      });
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    }
    const body = await request.clone().json();
    const messages = body.messages as Record<string, unknown>[];
    const ids = new Set(
      messages.flatMap((message) =>
        Array.isArray(message.tool_calls)
          ? message.tool_calls.map((call: { id: string }) => call.id)
          : [],
      ),
    );
    for (const message of messages)
      if (message.role === 'tool' && !ids.has(String(message.tool_call_id)))
        unmatchedResults.push(String(message.tool_call_id));
    if (unmatchedResults.length)
      return Response.json({ error: { message: 'orphaned tool result' } }, { status: 400 });
    return next.fetch(input, init);
  };
  const session = createAgentSession({
    host: createWorkbenchAgentHost({ session: currentProject() }),
    settings,
    fetch: transport,
  });
  let stopping: Promise<void> | undefined;
  session.subscribe((event) => {
    if (
      event.type === 'agent' &&
      event.event.type === 'message_update' &&
      event.event.message.role === 'assistant' &&
      event.event.message.content.some((block) => block.type === 'toolCall')
    )
      stopping ??= session.stop();
  });
  try {
    await session.send('Begin a tool call.');
    await stopping;
    const stopped = session.status();
    await session.send('Continue.');
    return {
      stopped,
      finished: session.status(),
      unmatchedResults,
      paths: (await currentProject().files.readdir('/')).map((entry) => entry.path),
      trace: await session.exportTrace(),
    };
  } finally {
    await session.dispose();
  }
}

export async function proveBomEdit() {
  await currentProject().files.writeFile('/bom.txt', new TextEncoder().encode('\ufeffalpha'), {
    expectedVersion: null,
  });
  const { session } = setup([
    [{ name: 'edit_file', args: { path: 'bom.txt', old: 'alpha', new: 'beta' } }],
    'Edited.',
  ]);
  try {
    await session.send('Replace alpha only.');
    return Array.from((await currentProject().files.readFile('/bom.txt')).bytes);
  } finally {
    await session.dispose();
  }
}
