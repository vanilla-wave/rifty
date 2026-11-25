/**
 * A sandbox template (ADR-0568 Corrections 2026-11-25): a `produceDependencySnapshot`
 * artifact whose `payload/node_modules` becomes a new sandbox's own files at `/node_modules`.
 * Decoded once per process into the encoded state of an empty sandbox over it (ADR-0567 bytes),
 * which every sandbox over it restores; nothing of it is shared after that (ADR-0568 §2).
 */
import { createHash } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { type Codec, loadCodec } from './codec-loader.ts';

/** A registered template: the artifact's `templateId` and its `snapshotId` (sha256 of the tar). */
export interface TemplateIdentity {
  readonly id: string;
  readonly version: string;
}

/** What a sandbox over a template starts from. */
export interface Template {
  readonly identity: TemplateIdentity;
  /** An empty sandbox over it, as snapshot bytes. */
  readonly state: Uint8Array;
  /** The codec's budget of `state`: the least `maxFsBytes` a sandbox over it takes. */
  readonly budget: number;
}

const MOUNT = '/node_modules';
const PAYLOAD = 'payload/node_modules';

const coded = <E extends Error>(error: E, code: string): E & { code: string } =>
  Object.assign(error, { code });

function artifactError(reason: string): Error {
  return coded(
    new Error(`isolate-host template: not a usable produceDependencySnapshot artifact (${reason})`),
    'ERR_ISOLATE_HOST_TEMPLATE_ARTIFACT',
  );
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

let decodes = 0;
/** Artifacts decoded in this process (a test seam for the once-per-process rule). */
export function decodeCount(): number {
  return decodes;
}

/** gzip by its magic, otherwise br (the producer's two encodings). */
function untar(artifact: Uint8Array): Uint8Array {
  if (artifact[0] === 0x1f && artifact[1] === 0x8b) {
    try {
      return gunzipSync(artifact);
    } catch (error) {
      throw artifactError(`gzip: ${reason(error)}`);
    }
  }
  try {
    return brotliDecompressSync(artifact);
  } catch (error) {
    throw artifactError(`neither gzip nor br: ${reason(error)}`);
  }
}

function decode(c: Codec, artifact: Uint8Array): Template {
  decodes++;
  const tar = untar(artifact);
  let entries: ReturnType<Codec['readDepSnapshotTar']>;
  let templateId: unknown;
  try {
    entries = c.readDepSnapshotTar(tar);
    templateId = c.readDepSnapshotManifest(entries).templateId;
  } catch (error) {
    throw artifactError(reason(error));
  }
  if (typeof templateId !== 'string' || templateId.length === 0)
    throw artifactError('the manifest names no templateId');
  const identity = {
    id: templateId,
    version: `sha256:${createHash('sha256').update(tar).digest('hex')}`,
  };
  const fs = new c.MemoryFsSync();
  for (const dir of c.GUEST_DIRS) fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(MOUNT, { recursive: true });
  const mounted = entries.filter((e) => e.path === PAYLOAD || e.path.startsWith(`${PAYLOAD}/`));
  const target = (path: string): string => MOUNT + path.slice(PAYLOAD.length);
  try {
    for (const e of mounted) {
      const path = target(e.path);
      if (e.directory) fs.mkdirSync(path, { recursive: true });
      else {
        fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
        fs.writeFileSync(path, e.bytes);
      }
    }
    // The tar's times (the producer writes 0), set once every child exists.
    for (const e of mounted) {
      const t = e.mtimeMs;
      fs.restoreStatSync(target(e.path), { mtimeMs: t, atimeMs: t, ctimeMs: t, birthtimeMs: t });
    }
    const state = c.snapshotFs(fs, { template: null, maxBytes: Number.MAX_SAFE_INTEGER });
    return { identity, state, budget: c.snapshotBudget(fs) };
  } catch (error) {
    // A name or time the snapshot format cannot hold.
    throw artifactError(reason(error));
  }
}

const key = ({ id, version }: TemplateIdentity): string => `${id}\0${version}`;
/** Templates by identity, for the process's life. */
const registered = new Map<string, Template>();
/** Artifacts by their bytes' sha256: one decode per artifact, concurrent calls included. */
const byArtifact = new Map<string, Promise<Template>>();

/** The template of `artifact`, decoded at most once in this process. */
export function templateOf(artifact: unknown): Promise<Template> {
  if (!(artifact instanceof Uint8Array))
    return Promise.reject(
      coded(new TypeError('The "artifact" argument must be a Uint8Array'), 'ERR_INVALID_ARG_TYPE'),
    );
  const digest = createHash('sha256').update(artifact).digest('hex');
  let template = byArtifact.get(digest);
  if (template === undefined) {
    // The bytes at the call: the caller may change its buffer while the codec loads.
    const bytes = new Uint8Array(artifact);
    template = loadCodec().then((c) => {
      const decoded = decode(c, bytes);
      const known = registered.get(key(decoded.identity));
      if (known !== undefined) return known;
      registered.set(key(decoded.identity), decoded);
      return decoded;
    });
    byArtifact.set(digest, template);
    // A refused artifact is not kept: the same bytes are refused again, by the same check.
    template.catch(() => byArtifact.delete(digest));
  }
  return template;
}

/** The registered template of `identity`; an unknown one is a named error. */
export function registeredTemplate(identity: TemplateIdentity): Template {
  const template =
    typeof identity.id === 'string' && typeof identity.version === 'string'
      ? registered.get(key(identity))
      : undefined;
  if (template === undefined)
    throw coded(
      new Error(
        `isolate-host template: no template ${String(identity.id)}@${String(identity.version)} is registered in this process`,
      ),
      'ERR_ISOLATE_HOST_TEMPLATE_UNKNOWN',
    );
  return template;
}

/** Decode `artifact` once for this process; `createSandbox({ template })` then takes the identity. */
export async function registerTemplate(artifact: Uint8Array): Promise<TemplateIdentity> {
  try {
    const { identity } = await templateOf(artifact);
    return { ...identity };
  } catch (error) {
    // No frame or path of this process reaches the caller (ADR-0568 §7).
    if (error instanceof Error) error.stack = `${error.name}: ${error.message}`;
    throw error;
  }
}
