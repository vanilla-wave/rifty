/**
 * `/*! … *\/` legal comment carrying an upstream license verbatim, written at the
 * top of a generated artifact: bundlers keep it next to the code (esbuild/tsup
 * default `legalComments: 'eof'`). Gate: `pnpm check:third-party-notices`.
 */
export function legalComment(/** @type {string} */ license, /** @type {string} */ note) {
  const text = `${note}\n\n${license.trimEnd()}`;
  if (text.includes('*/')) throw new Error(`License text would close its comment: ${note}`);
  return `/*! ${text}\n */\n`;
}
