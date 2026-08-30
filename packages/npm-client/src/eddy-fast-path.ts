/**
 * ADR-0182 opt-in eddy fast path (extracted from installer.ts, move-only):
 * bundle acquisition attempts (prefetch → pinned GET → POST), streamed
 * verification + adoption, and the no-I/O lockfile-request analysis backing
 * the Eddy provenance gates.
 */

import { discardBody, fetchHeadersBounded } from './bounded-fetch.ts';
import { closureHashOf } from './closure-hash.ts';
import {
  DEFAULT_BUNDLE_STALL_MS,
  drainBodyBounded,
  streamTarEntries,
} from './eddy-bundle-stream.ts';
import {
  EDDY_BUNDLE_FORMAT,
  type EddyBundleManifestV1,
  type EddyBundleTarballEntry,
  LOCKFILE_FILE,
  MANIFEST_FILE,
  isIsoDateString,
} from './eddy-bundle.ts';
import {
  EDDY_STORE_DURABLE_HEADER,
  type EddyRequestBody,
  bundleUrlFor,
  canonicalEddyRequestKey,
} from './eddy-request.ts';
import {
  bundleCompletenessGapForPaths,
  pinnedEntryForParent,
} from './installer-lockfile-reader.ts';
import { hasEffectiveTopLevelNameCollision, hasParentScopedOverride } from './installer-peers.ts';
import {
  type ResolveContext,
  lockfileReuseDecision,
  registryOwnsIncrementalMiss,
} from './installer-walk.ts';
import type { InstallOptions } from './installer.ts';
import { builtinRecipeForRequest } from './internal/shadow/admission.ts';
import type { ShadowAssetPlan } from './internal/shadow/planner.ts';
import {
  planShadowSubstitutionsFromLockfile,
  registryShadowEmbeddedSourcesFromLockfile,
} from './internal/shadow/planner.ts';
import type { Lockfile } from './linker.ts';
import type { OverrideMap } from './overrides.ts';
import {
  assertShimSupported,
  companionRequestsFor,
  resolveEffectivePackageRequest,
} from './shadow-shims.ts';
import { type TarballCache, computeIntegrity, parseIntegrityAlgorithm } from './tarball-cache.ts';
import { parseTarEntries } from './unpacker.ts';
import { abortReason, awaitWithSignal } from './utils/abort-signal.ts';

/** Skip Eddy when the existing lock owns replay or a loud structural failure. */
export function existingLockfilePreemptsEddy(
  existingLockfile: Lockfile | null,
  shadowPlan: ShadowAssetPlan | null,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  opts: InstallOptions,
): boolean {
  if (!existingLockfile) return false;
  if (!shadowPlan) throw new TypeError('decoded lockfile shadow plan is missing');
  if (
    hasEffectiveTopLevelNameCollision(dependencies, optionalDependencies, rootName, opts.overrides)
  ) {
    return false;
  }
  return (
    analyzeLockfileRequest(
      existingLockfile,
      shadowPlan,
      dependencies,
      optionalDependencies,
      rootName,
      opts.overrides,
    ).ownership !== 'metadata'
  );
}

/**
 * ADR-0182 opt-in fast path. Obtain an `EddyBundleV1` from the resolver, verify
 * it (bytes vs the bundle integrity — NON-disableable, mirror-grade trust),
 * check the bundle lockfile covers the request, seed the tarball cache, write
 * the lockfile. Returns the adopted bundle's optional learnable closureHash +
 * its STAGED lockfile on success (the existing lockfile fast path then runs
 * with zero packument network from the in-memory lockfile; the hash feeds
 * learned pins only when the response is safe to persist, ADR-0194 — the caller
 * commits the lockfile to disk only after link/shims succeed); on ANY failure
 * it warns and returns `null`, leaving the pre-existing lockfile untouched so
 * the standard verifying install runs. Never throws.
 *
 * The bundle can arrive via THREE attempts, first survivor wins, each failure
 * falls through to the next: a prefetched response (`resolverPrefetch`,
 * consumed only on a canonical-request match), the pinned cacheable
 * `GET /bundle/<closureHash>` (`resolverClosureHash`), and the POST resolve.
 * `prefer: 'online'` runs the POST ONLY — pinned GET/prefetch serve a
 * content-addressed CACHED closure, exactly what online promises to bypass
 * (the POST carries `prefer` so the server skips its mutable tier too).
 */
export async function tryEddyFastPath(
  opts: InstallOptions,
  rootName: string,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  tarballCache: TarballCache,
): Promise<
  | {
      kind: 'adopted';
      closureHash?: string;
      resolvedAt?: string;
      resolvedVia: 'get' | 'post';
      lockfile: Lockfile;
      shadowPlan: ShadowAssetPlan;
    }
  | {
      kind: 'declined';
      reason: string;
      cause: Error;
    }
> {
  const url = opts.resolverUrl;
  if (!url) return declineEddy('resolver URL unavailable');

  const online = opts.prefer === 'online';
  const body: EddyRequestBody = { dependencies, optionalDependencies };
  if (opts.overrides) body.overrides = opts.overrides;
  const requestKey = canonicalEddyRequestKey(body, opts.prefer ?? 'cached');

  // prefer:'online' (the `--prefer-online` analogue) promises a FRESH
  // server-side recompute — a pinned prefetch/GET would serve a cached
  // closure, so neither enters the pipeline (only the POST, which carries
  // `prefer` to the server).
  const prefetched = online ? null : (opts.resolverPrefetch?.take(requestKey) ?? null);
  // `expectedHash` names the hash a CONTENT-ADDRESSED fetch must return: a pinned
  // GET (or a pinned prefetch) is `GET /bundle/<hash>`, so the bundle's manifest
  // MUST self-report that hash — else the CDN/cache served the wrong object and we
  // decline (defence-in-depth over the origin's own key check). A POST has no
  // pre-known hash (the server computes it), so it carries none.
  // `via` = the underlying REQUEST KIND, the provenance `InstallResult`
  // carries: a prefetch is just an early GET (pinned) or POST (unpinned) —
  // labelling it 'prefetch' would hide that an unpinned boot prefetch is a
  // server-vouched resolution and the profile would never learn its pin.
  type EddyAttempt =
    | {
        kind: 'prefetch';
        label: 'prefetch';
        via: 'get' | 'post';
        expectedHash?: string;
        response: Promise<Response>;
      }
    | {
        kind: 'fetch';
        label: 'get' | 'post';
        via: 'get' | 'post';
        expectedHash?: string;
        run: (signal: AbortSignal) => Promise<Response>;
      };
  const attempts: EddyAttempt[] = [];
  if (prefetched) {
    attempts.push({
      kind: 'prefetch',
      label: 'prefetch',
      via: opts.resolverPrefetch?.closureHash ? 'get' : 'post',
      ...(opts.resolverPrefetch?.closureHash
        ? { expectedHash: opts.resolverPrefetch.closureHash }
        : {}),
      response: prefetched,
    });
  }
  const pin = online ? undefined : opts.resolverClosureHash;
  // The pinned GET is ALWAYS in the (cached-preference) pipeline
  // (prefetch → GET → POST): a SUCCESSFUL same-pin prefetch short-circuits
  // before reaching it (first survivor wins), so this only runs when the
  // prefetch failed/stalled/was declined — where retrying the direct GET is
  // exactly the contract (and a consumed-prefetch decline over a CDN mixup can
  // still succeed here).
  if (pin) {
    const bundleBase = opts.resolverBundleBaseUrl ?? url;
    attempts.push({
      kind: 'fetch',
      label: 'get',
      via: 'get',
      expectedHash: pin,
      run: (signal) => fetch(bundleUrlFor(bundleBase, pin), { signal }),
    });
  }
  attempts.push({
    kind: 'fetch',
    label: 'post',
    via: 'post',
    run: (signal) => {
      const requestBody: Record<string, unknown> = { ...body };
      if (opts.prefer) requestBody.prefer = opts.prefer;
      // No content-type header: a string body defaults to `text/plain` — a
      // CORS-simple request, so a cross-origin browser skips the OPTIONS
      // preflight (one RTT off the cold path). The server parses the body
      // unconditionally.
      return fetch(url, { method: 'POST', body: JSON.stringify(requestBody), signal });
    },
  });

  const headersStallMs = opts.resolverStallTimeoutMs ?? DEFAULT_BUNDLE_STALL_MS;
  const reasons: string[] = [];
  const causes: Error[] = [];
  for (const attempt of attempts) {
    try {
      // Header-phase bound (shared chokepoint): `resolverStallTimeoutMs` (and
      // the default stall bound) only start once a body exists — a fetch whose
      // connection/headers hang parked `npm install` before any body bound
      // could run. Prefetch carries its own header + eager-drain bounds in
      // `startEddyPrefetch`; racing its already-buffering promise here would
      // abandon a slow-but-progressing download and duplicate the request.
      const response =
        attempt.kind === 'prefetch'
          ? await awaitWithSignal(attempt.response, opts.signal, 'eddy prefetch')
          : await fetchHeadersBounded(
              attempt.run,
              headersStallMs,
              `eddy ${attempt.label}`,
              opts.signal,
            );
      const outcome = await consumeEddyResponse(
        response,
        dependencies,
        optionalDependencies,
        rootName,
        opts,
        tarballCache,
        attempt.expectedHash,
      );
      if (typeof outcome !== 'string') {
        return {
          kind: 'adopted',
          ...(outcome.closureHash === undefined ? {} : { closureHash: outcome.closureHash }),
          ...(outcome.resolvedAt === undefined ? {} : { resolvedAt: outcome.resolvedAt }),
          resolvedVia: attempt.via,
          lockfile: outcome.lockfile,
          shadowPlan: outcome.shadowPlan,
        };
      }
      const cause = new Error(`${attempt.label}: ${outcome}`);
      reasons.push(cause.message);
      causes.push(cause);
    } catch (err) {
      if (opts.signal?.aborted) throw abortReason(opts.signal, 'npm install');
      const cause = err instanceof Error ? err : new Error(String(err));
      reasons.push(`${attempt.label}: ${cause.message}`);
      causes.push(cause);
    }
  }
  return declineEddy(reasons.join('; '), causes);
}

const eddyDecoder = new TextDecoder('utf-8');

async function* bufferedTarEntries(
  bytes: Uint8Array,
): AsyncGenerator<{ name: string; data: Uint8Array }, void, undefined> {
  for (const e of parseTarEntries(bytes)) yield e;
}

/**
 * Verify + adopt ONE bundle response; `{adopted, closureHash?}` on success, a
 * decline reason string otherwise (ADR-0194 threads a learnable hash out for
 * learned pins). The bundle is consumed AS A STREAM (network overlaps hash +
 * cache writes): the format/v3/coverage gates run on the manifest + lockfile members
 * — the first two, by bundle contract — so a decline cancels the download
 * before tarball bytes transfer. Each tarball is verified against the
 * integrity the BUNDLE carries (ADR-0182 §5, non-disableable) and seeded into
 * the content-addressed cache as it arrives: a mid-bundle failure leaves only
 * verified bytes (the cache re-verifies on every `get`). The lockfile is
 * returned STAGED (in memory), never written here: the caller commits the
 * final lockfile only after link/shims succeed, so a failure at ANY point —
 * including after adoption — leaves the pre-existing lockfile untouched.
 *
 * Content-addressed integrity (ADR-0194): the manifest's self-reported
 * `closureHash` must (a) equal `expectedClosureHash` when the fetch was a pinned
 * GET/prefetch — else the CDN served the wrong object — and (b) re-derive from
 * the bundle's own lockfile — else the bundle lies about its identity. Both gate
 * BEFORE any tarball seed or lockfile write.
 */
async function consumeEddyResponse(
  response: Response,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  opts: InstallOptions,
  tarballCache: TarballCache,
  expectedClosureHash?: string,
): Promise<
  | {
      adopted: true;
      closureHash?: string;
      resolvedAt?: string;
      lockfile: Lockfile;
      shadowPlan: ShadowAssetPlan;
    }
  | string
> {
  // A JSON body is a typed decline (server.ts sends them as 422 + JSON), so
  // parse it BEFORE the status gate — otherwise `!response.ok` swallows the
  // 422 as an opaque `HTTP 422` and the `feature` reason is never surfaced.
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    // A JSON decline body is proxy/attacker-controlled just like the tar stream:
    // `response.json()` has NO timeout, so a resolver that sends
    // `content-type: application/json` then holds the body open parks
    // `npm install` forever — bypassing `resolverStallTimeoutMs`. Drain it
    // through the same no-progress/byte bound, then parse.
    let declineText: string;
    try {
      const bytes = await drainBodyBounded(response, {
        label: 'eddy decline body',
        ...(opts.resolverStallTimeoutMs === undefined
          ? {}
          : { stallTimeoutMs: opts.resolverStallTimeoutMs }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
      declineText = eddyDecoder.decode(bytes);
    } catch {
      if (opts.signal?.aborted) throw abortReason(opts.signal, 'npm install');
      return 'resolver decline body stalled or exceeded its byte cap';
    }
    let decline: { feature?: string; error?: string } | null;
    try {
      decline = JSON.parse(declineText) as { feature?: string; error?: string };
    } catch {
      decline = null;
    }
    return `resolver declined (${decline?.feature ?? decline?.error ?? 'unsupported'})`;
  }
  if (!response.ok) {
    // Never-consumed body (the attempt pipeline moves on) — hits every
    // unpinned 404 GET miss; see discardBody.
    discardBody(response);
    return `resolver returned HTTP ${response.status}`;
  }

  // Bounded stream (round 6): a stall/runaway on the DIRECT GET/POST paths
  // must fail the attempt (→ fallback), exactly like the prefetch's bounded
  // drain — an unbounded read here parked `npm install` forever on a resolver
  // that sent a covering manifest+lockfile then hung mid-tarball.
  const entries = response.body
    ? streamTarEntries(response.body, {
        ...(opts.resolverStallTimeoutMs === undefined
          ? {}
          : { stallTimeoutMs: opts.resolverStallTimeoutMs }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      })
    : bufferedTarEntries(new Uint8Array(await response.arrayBuffer()));

  let manifest: EddyBundleManifestV1 | null = null;
  let lockfile: Lockfile | null = null;
  let shadowPlan: ShadowAssetPlan | null = null;
  const byFile = new Map<string, EddyBundleTarballEntry>();
  const seededFiles = new Set<string>();
  const seededTarballs: EddyBundleTarballEntry[] = [];
  for await (const entry of entries) {
    if (manifest === null) {
      if (entry.name !== MANIFEST_FILE) return `bundle does not start with ${MANIFEST_FILE}`;
      const parsed = JSON.parse(eddyDecoder.decode(entry.data)) as EddyBundleManifestV1;
      if (parsed.format !== EDDY_BUNDLE_FORMAT) {
        return `unsupported EddyBundle format: ${JSON.stringify(parsed.format)}`;
      }
      // Content-addressed GET/prefetch: the served object must BE the hash we
      // asked for (a wrong one = CDN/cache mixup). Checked at member 1, before
      // any seed/write.
      if (expectedClosureHash !== undefined && parsed.asOf.closureHash !== expectedClosureHash) {
        return `bundle closure hash ${parsed.asOf.closureHash} ≠ requested ${expectedClosureHash}`;
      }
      for (const t of parsed.tarballs) {
        // Duplicate `file` values collapse in this map: two required
        // name@version entries sharing one member would pass BOTH the
        // seeded-count check (1 === 1) and the completeness gate (both
        // name@version present in the manifest ARRAY) while only one package
        // ever gets seeded — a partial adoption. Malformed → decline.
        if (byFile.has(t.file)) {
          return `bundle manifest names duplicate member ${t.file}`;
        }
        byFile.set(t.file, t);
      }
      manifest = parsed;
      continue;
    }
    if (lockfile === null) {
      if (entry.name !== LOCKFILE_FILE) return `bundle missing ${LOCKFILE_FILE} before tarballs`;
      const parsed = JSON.parse(eddyDecoder.decode(entry.data)) as Lockfile;
      // Refuse a non-v3 bundle lockfile BEFORE seeding/writing. Honest eddy
      // always emits v3 (`linker.ts` hardcode), but a divergent/buggy resolver
      // could send another shape; writing it would clobber the user's lockfile
      // AND make the post-seed re-read throw `NotImplementedError(v1/v2)` —
      // breaking BOTH the never-throw and lockfile-untouched promises.
      if ((parsed.lockfileVersion as number) !== 3) {
        return `bundle lockfile is not v3 (got ${JSON.stringify(parsed.lockfileVersion)})`;
      }
      // Self-consistency: a content-addressed bundle must hash to the hash it
      // names. Re-derive from the bundle's OWN lockfile (member 2, before any
      // seed/write) so a manifest that lies about its closure is refused, never
      // adopted or learned as a pin.
      if (manifest !== null && manifest.asOf.closureHash !== (await closureHashOf(parsed))) {
        return `bundle manifest closure hash ${manifest.asOf.closureHash} does not match its lockfile`;
      }
      // A v3 lockfile records effective pins, not which parent-scoped policy
      // selected them. Local replay has the current request context; an
      // imported bundle cannot prove that provenance, so keep Eddy additive
      // and fall back to the standard resolver for this policy shape.
      if (hasParentScopedOverride(opts.overrides)) {
        return 'bundle lockfile does not cover the request (or an override forces a re-resolve)';
      }
      const requestAnalysis = analyzeLockfileRequest(
        parsed,
        planShadowSubstitutionsFromLockfile(parsed),
        dependencies,
        optionalDependencies,
        rootName,
        opts.overrides,
      );
      if (requestAnalysis.ownership !== 'replay') {
        return 'bundle lockfile does not cover the request (or an override forces a re-resolve)';
      }
      // Completeness (round 6): a covering lockfile whose reachable packages
      // lack a matching manifest tarball would replay the omissions from the
      // ORDINARY registry on cache miss while claiming `source: 'eddy'` — a
      // provenance lie (and a learned pin to a partial bundle). Gate at member
      // 2, before any tarball seed or lockfile write.
      const gap = bundleCompletenessGapForPaths(
        parsed,
        requestAnalysis.reachablePaths,
        manifest?.tarballs ?? [],
      );
      if (gap) return gap;
      lockfile = parsed;
      shadowPlan = requestAnalysis.shadowPlan;
      continue;
    }
    const t = byFile.get(entry.name);
    if (!t) return `unexpected bundle member ${entry.name}`;
    const algorithm = parseIntegrityAlgorithm(t.integrity);
    if (!algorithm) return `unparseable integrity for ${t.name}@${t.version}`;
    if ((await computeIntegrity(entry.data, algorithm)) !== t.integrity) {
      return `integrity mismatch for ${t.name}@${t.version}`;
    }
    await tarballCache.put(t.name, t.version, t.integrity, entry.data);
    seededFiles.add(entry.name);
    seededTarballs.push(t);
  }
  if (manifest === null || lockfile === null || shadowPlan === null) {
    return 'malformed EddyBundleV1 bundle: missing manifest or lockfile';
  }
  if (seededFiles.size !== byFile.size) {
    return 'bundle is missing tarball member(s) named by its manifest';
  }
  // Provenance guard: adoption reports `source: 'eddy'` and then REPLAYS the
  // install by reading `tarballCache` back. A NON-RETENTIVE or bounded cache
  // could silently re-fetch some packages from the REGISTRY under an eddy label
  // (and fail outright if the registry is unreachable). Prove every seeded
  // tarball is still retained; a miss means eddy cannot honestly own this
  // install → decline to the standard verifying path (which uses the same cache
  // and is labelled `source: 'standard'`, no lie).
  for (const seeded of seededTarballs) {
    const back = await tarballCache.get(seeded.name, seeded.version, seeded.integrity);
    if (back === null) {
      return 'tarball cache did not retain seeded bytes (a non-retentive cache cannot back an eddy install)';
    }
  }
  const canLearnClosureHash =
    expectedClosureHash !== undefined || response.headers.get(EDDY_STORE_DURABLE_HEADER) === '1';
  const closureHash = canLearnClosureHash ? manifest.asOf.closureHash : undefined;
  // The served bundle's as-of stamp: the stale-pin honesty line reports THIS
  // (the resolution's age), never the pin file's savedAt. Validated — a
  // malformed stamp reads as absent (the line then says `unknown`), never a
  // raw junk string on the terminal.
  const rawResolvedAt = manifest.asOf.resolvedAt;
  const resolvedAt = isIsoDateString(rawResolvedAt) ? rawResolvedAt : undefined;
  return {
    adopted: true,
    ...(closureHash === undefined ? {} : { closureHash }),
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    lockfile,
    shadowPlan,
  };
}

function declineEddy(
  reason: string,
  causes: readonly Error[] = [],
): { readonly kind: 'declined'; readonly reason: string; readonly cause: Error } {
  console.warn(`npm: fast install (eddy) unavailable, using standard install — ${reason}`);
  const cause =
    causes.length === 0
      ? new Error(reason)
      : causes.length === 1
        ? causes[0]!
        : new AggregateError([...causes], `Eddy acquisition declined: ${reason}`);
  return { kind: 'declined', reason, cause };
}

type LockfileRequestOwnership = 'replay' | 'metadata' | 'broken';

function mergeLockfileRequestOwnership(
  left: LockfileRequestOwnership,
  right: LockfileRequestOwnership,
): LockfileRequestOwnership {
  if (left === 'broken' || right === 'broken') return 'broken';
  if (left === 'metadata' || right === 'metadata') return 'metadata';
  return 'replay';
}

interface LockfileRequestAnalysis {
  readonly ownership: LockfileRequestOwnership;
  readonly reachablePaths: ReadonlySet<string>;
  readonly shadowPlan: ShadowAssetPlan;
}

/** No-I/O mirror of the mixed resolver, used by the Eddy provenance gates. */
function analyzeLockfileRequest(
  lockfile: Lockfile,
  shadowPlan: ShadowAssetPlan,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  overrides: OverrideMap | undefined,
): LockfileRequestAnalysis {
  const reachablePaths = new Set<string>();
  const embeddedPaths = new Set(
    registryShadowEmbeddedSourcesFromLockfile(lockfile, shadowPlan).flatMap((source) =>
      source.dependencies.map((dependency) => dependency.installPath),
    ),
  );
  let ownership: LockfileRequestOwnership = 'replay';
  const recordOwnership = (next: LockfileRequestOwnership): void => {
    ownership = mergeLockfileRequestOwnership(ownership, next);
  };

  const visit = (name: string, range: string | null, ctx: ResolveContext): void => {
    const decision = lockfileReuseDecision(lockfile, shadowPlan, name, range, ctx, overrides);
    if (decision.kind === 'miss') {
      recordOwnership(registryOwnsIncrementalMiss(decision, ctx) ? 'metadata' : 'broken');
      return;
    }
    const { effectiveName } = resolveEffectivePackageRequest(
      name,
      range,
      ctx.parentName,
      overrides,
    );
    const hit = pinnedEntryForParent(lockfile, effectiveName, ctx.parentLockfilePath);
    const recipe = builtinRecipeForRequest(
      name,
      range,
      ctx.parentName,
      overrides,
      hit?.entry.version,
    );
    if (
      !hit ||
      (recipe?.acquisition.kind !== 'synthetic' && (!hit.entry.resolved || !hit.entry.integrity))
    ) {
      recordOwnership('broken');
      return;
    }
    assertShimSupported(effectiveName, hit.entry.version);
    if (reachablePaths.has(hit.installPath)) return;
    reachablePaths.add(hit.installPath);
    const childContext: ResolveContext = {
      parentName: effectiveName,
      parentInstallPath: hit.installPath,
      parentLockfilePath: hit.installPath,
      parentOrigin: 'lockfile',
      lockfilePathTranslations: [],
    };
    for (const [childName, childRange] of Object.entries(hit.entry.dependencies ?? {})) {
      if (embeddedPaths.has(`${hit.installPath}/node_modules/${childName}`)) continue;
      visit(childName, childRange, childContext);
    }
    for (const [companionName, companionRange] of Object.entries(
      companionRequestsFor(effectiveName, hit.entry.version),
    )) {
      visit(companionName, companionRange, childContext);
    }
  };

  const rootContext: ResolveContext = {
    parentName: rootName,
    parentInstallPath: '',
    parentLockfilePath: '',
    parentOrigin: 'root',
    lockfilePathTranslations: [],
  };
  for (const [name, range] of Object.entries(dependencies)) {
    visit(name, range, rootContext);
  }
  for (const [name, range] of Object.entries(optionalDependencies)) {
    try {
      visit(name, range, rootContext);
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code === 'EBROKENLOCK' || code === 'EINSTALLPATHCONFLICT') {
        recordOwnership('broken');
      }
    }
  }
  return { ownership, reachablePaths, shadowPlan };
}
