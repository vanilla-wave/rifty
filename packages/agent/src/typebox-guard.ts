import { NotImplementedError } from '@riftydev/io';
import * as Format from 'typebox/format';

// pi-ai 1.5.0 validates tool arguments as JSON Schema only. Of the TypeBox semantics
// pi 0.85.1 applied, two now silently stop: refinements and Format.Set checks
// (differential probe: docs/backlog/distribution/reference/pi-typebox-validation-diff.json).
// Everything else validates as before or now rejects loudly. ADR-0570 §3.
const builtInFormats = new Set<unknown>(
  Object.entries(Format).flatMap(([name, value]) => (name.startsWith('Is') ? [value] : [])),
);
const schemaMaps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const schemaLists = ['anyOf', 'allOf', 'oneOf', 'prefixItems'];
const schemaValues = [
  'items',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
];

function lost(schema: unknown): string | undefined {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const node = schema as Record<string, unknown>;
  if (
    Object.hasOwn(node, '~refine') &&
    !Object.getOwnPropertyDescriptor(node, '~refine')?.enumerable
  )
    return 'Type.Refine';
  if (typeof node.format === 'string') {
    const check = Format.Get(node.format);
    if (check && !builtInFormats.has(check)) return `Format.Set('${node.format}')`;
  }
  const children = [
    ...schemaMaps.flatMap((key) =>
      node[key] && typeof node[key] === 'object' ? Object.values(node[key] as object) : [],
    ),
    ...schemaLists.flatMap((key) => (Array.isArray(node[key]) ? (node[key] as unknown[]) : [])),
    ...schemaValues.flatMap((key) =>
      Array.isArray(node[key]) ? (node[key] as unknown[]) : [node[key]],
    ),
  ];
  for (const child of children) {
    const found = lost(child);
    if (found) return found;
  }
  return undefined;
}

export function assertPiValidates(name: string, parameters: unknown): void {
  const found = lost(parameters);
  if (found)
    throw new NotImplementedError(
      'agent.tool-schema-typebox-only',
      `Tool ${name}: ${found} is not JSON Schema; pi 1.x does not apply it to tool arguments.`,
    );
}
