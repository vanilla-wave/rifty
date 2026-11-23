import * as Format from 'typebox/format';
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

// Differential probe (pi-typebox-validation-diff.json): only refinements and Format.Set
// checks silently stop on pi 1.x; the guard refuses exactly those.
const customFormat = () => {
  Format.Set('rifty-even', (value) => value.length % 2 === 0);
  return Type.String({ format: 'rifty-even' });
};
it.each([
  ['Type.Refine', () => Type.Refine(Type.String(), (value) => value.startsWith('/'))],
  ["Format.Set('rifty-even')", customFormat],
])('a %s tool parameter fails loudly at session creation', (kind, schema) => {
  expect(() => session(Type.Object({ path: schema() }))).toThrow(
    `Not implemented: agent.tool-schema-typebox-only (Tool probe: ${kind}`,
  );
});

it.each([
  [
    'Type.Codec',
    () =>
      Type.Codec(Type.String())
        .Decode((v) => v)
        .Encode((v) => v),
  ],
  ['Type.BigInt', () => Type.BigInt()],
  ['Type.Void', () => Type.Void()],
  ['Union with Undefined', () => Type.Union([Type.String(), Type.Undefined()])],
  ['built-in email format', () => Type.String({ format: 'email' })],
  [
    'data in examples/default',
    () => Type.String({ examples: [{ type: 'void' }], default: { type: 'bigint' } }),
  ],
  ['a property named ~refine', () => Type.Object({ '~refine': Type.String() })],
])(
  '%s keeps its 0.85.1 behavior or fails loudly on its own; the session is created',
  (_kind, schema) => {
    void session(Type.Object({ path: schema() })).dispose();
  },
);

function session(parameters: ReturnType<typeof Type.Object>) {
  return createAgentSession({
    host: { root: '/', capabilities: () => ({}), async close() {} },
    ...modelCatalog(),
    tools: [
      {
        name: 'probe',
        label: 'probe',
        description: 'Probe tool',
        parameters,
        execute: async () => ({ content: [], details: undefined }),
      },
    ],
  });
}
