import { NotImplementedError } from '@riftydev/io';
import * as Format from 'typebox/format';

// pi-ai 1.5.0 validates tool arguments as JSON Schema only. Of the TypeBox semantics
// pi 0.85.1 applied, two now silently stop: refinements and Format.Set checks
// (differential probe: docs/backlog/distribution/reference/pi-typebox-validation-diff.json).
// Everything else validates as before or now rejects loudly. ADR-0570 §3.
// TypeBox's own checker under its own name (IsDateTime → date-time, IsIPv4 → ipv4): those
// are the standard formats pi-schema also checks. An alias of a built-in is still custom.
const builtInFormats = new Map<string, unknown>(
  Object.entries(Format).flatMap(([name, value]) =>
    name.startsWith('Is')
      ? [
          [
            name
              .slice(2)
              .replace(/IPv(\d)/, 'Ipv$1')
              .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
              .toLowerCase(),
            value,
          ],
        ]
      : [],
  ),
);
const schemaMaps = [
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'dependencies',
];
const schemaLists = ['anyOf', 'allOf', 'oneOf', 'prefixItems'];
const schemaValues = [
  'items',
  'additionalItems',
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
    if (check && builtInFormats.get(node.format) !== check) return `Format.Set('${node.format}')`;
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
