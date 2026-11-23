import { expect, it } from 'vitest';
import reference from '../../../docs/backlog/distribution/reference/pi-0.85.1-typebox-tool-probe.json' with {
  type: 'json',
};
import { modelCatalog } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-catalog.ts';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { Type, createAgentSession } from './index.ts';

// ADR-0570: the public TypeBox `Type` keeps the 0.85.1 tool contract on Pi 1.x.
it('Type.Object tool reaches the wire and validates as on pi 0.85.1', async () => {
  const cases = reference.result.outcomes.map(({ args }) => args as Record<string, unknown>);
  const executed: unknown[] = [];
  const provider = scriptedProvider([...cases.map((args) => [{ name: 'probe', args }]), 'Done']);
  const session = createAgentSession({
    host: { root: '/', capabilities: () => ({}), async close() {} },
    ...modelCatalog(undefined, provider.fetch),
    tools: [
      {
        name: 'probe',
        label: 'probe',
        description: 'Probe tool',
        parameters: Type.Object({
          path: Type.String(),
          count: Type.Optional(Type.Integer({ minimum: 0 })),
        }),
        execute: async (_id, args) => {
          executed.push(args);
          return { content: [{ type: 'text', text: 'ok' }], details: undefined };
        },
      },
    ],
  });
  try {
    await session.send('probe');
    expect(session.status()).toBe(reference.result.status);
    // Pi 1.x omits `strict: false` for endpoints without strict-mode support (API default).
    const { strict: _strict, ...declared } = reference.result.wireTool.function;
    expect(provider.requests[0]?.body.tools.find((t) => t.function.name === 'probe')).toEqual({
      ...reference.result.wireTool,
      function: declared,
    });
    expect(executed).toEqual(reference.result.executed);
    const results = (await session.exportTrace()).transcript.flatMap((message) =>
      message.role === 'toolResult' ? [message] : [],
    );
    const failed = (text: string | undefined) => text?.match(/\n {2}- (\w+):/)?.[1];
    expect(
      results.map((result) => {
        const text = result.content[0]?.type === 'text' ? result.content[0].text : undefined;
        return { isError: result.isError, failed: failed(text) };
      }),
    ).toEqual(
      reference.result.outcomes.map(({ result }) => ({
        isError: result.isError,
        failed: failed(result.text),
      })),
    );
  } finally {
    await session.dispose();
  }
});

// pi-ai 1.5.0 validates as JSON Schema only; TypeBox-only kinds would silently stop applying.
it.each([
  ['Type.Refine', () => Type.Refine(Type.String(), (value) => value.startsWith('/'))],
  [
    'Type.Codec',
    () =>
      Type.Codec(Type.String())
        .Decode((value) => value)
        .Encode((value) => value),
  ],
  ['Type bigint', () => Type.BigInt()],
])('a %s tool parameter fails loudly at session creation', (kind, schema) => {
  expect(() =>
    createAgentSession({
      host: { root: '/', capabilities: () => ({}), async close() {} },
      ...modelCatalog(),
      tools: [
        {
          name: 'probe',
          label: 'probe',
          description: 'Probe tool',
          parameters: Type.Object({ path: schema() }),
          execute: async () => ({ content: [], details: undefined }),
        },
      ],
    }),
  ).toThrow(`Not implemented: agent.tool-schema-typebox-only (Tool probe: ${kind}`);
});
