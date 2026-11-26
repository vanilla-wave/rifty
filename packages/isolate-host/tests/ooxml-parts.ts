/**
 * An OOXML package (pptx/docx/xlsx) as compared by the library probe
 * (`docs/backlog/distribution/reference/isolate-library-probe/`): XML parts as text with the ISO
 * timestamps of `docProps/core.xml` masked, binary parts as base64, a nested package by part.
 */
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ZipEntry {
  readonly dir: boolean;
  async(type: 'nodebuffer'): Promise<Buffer>;
}
interface Zip {
  readonly files: Readonly<Record<string, ZipEntry>>;
}
interface JSZipStatic {
  loadAsync(data: Uint8Array): Promise<Zip>;
}

const here = dirname(fileURLToPath(import.meta.url));
// pptxgenjs's own JSZip, in real Node: a reader of every package these tests write.
const JSZip = createRequire(
  join(realpathSync(join(here, '../node_modules/pptxgenjs')), 'package.json'),
)('jszip') as JSZipStatic;

const mask = (text: string): string =>
  text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z/g, '<time>');

/** Part name → masked text (XML) or base64 (binary); a nested package as `<name>!<part>`. */
export async function ooxmlParts(bytes: Uint8Array, prefix = ''): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(bytes);
  const out: Record<string, string> = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const data = await entry.async('nodebuffer');
    if (/\.(xlsx|docx|pptx|zip)$/.test(name))
      Object.assign(out, await ooxmlParts(data, `${name}!`));
    else if (/\.(xml|rels|vml)$/.test(name)) {
      const text = data.toString('utf8');
      out[prefix + name] = name === 'docProps/core.xml' ? mask(text) : text;
    } else out[prefix + name] = data.toString('base64');
  }
  return out;
}
