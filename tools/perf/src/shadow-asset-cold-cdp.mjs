function refuse(note) {
  return { ok: false, note };
}

function packumentUrl(registryUrl, packageName) {
  let parsed;
  try {
    parsed = new URL(registryUrl);
  } catch {
    throw new TypeError('standard asset source registryUrl must be an absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('standard asset source registryUrl must use http(s)');
  }
  const base = registryUrl.replace(/\/$/u, '');
  return `${base}/${encodeURIComponent(packageName).replace('%40', '@')}`;
}

function validSource(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.version === 'string' &&
    value.version.length > 0 &&
    typeof value.integrity === 'string' &&
    value.integrity.length > 0
  );
}

function successfulPackument(record) {
  return record?.status === 200 && record.complete === true;
}

function decodedPackument(record, label) {
  if (typeof record.bodyText !== 'string') {
    return refuse(`${label} successful packument lacks decoded body evidence`);
  }
  if (new TextEncoder().encode(record.bodyText).byteLength !== record.bodyBytes) {
    return refuse(`${label} decoded packument byte evidence is inconsistent`);
  }
  try {
    return { ok: true, value: JSON.parse(record.bodyText) };
  } catch {
    return refuse(`${label} packument response is not valid JSON`);
  }
}

function exactDist(packument, source, label) {
  if (packument === null || typeof packument !== 'object' || Array.isArray(packument)) {
    return refuse(`${label} packument response is not an object`);
  }
  if (packument.name !== undefined && packument.name !== source.name) {
    return refuse(`${label} packument names a different package`);
  }
  const versions = packument.versions;
  if (versions === null || typeof versions !== 'object' || Array.isArray(versions)) {
    return refuse(`${label} packument lacks a versions map`);
  }
  const manifest = versions[source.version];
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return refuse(`${label} packument lacks the exact version`);
  }
  if (manifest.name !== undefined && manifest.name !== source.name) {
    return refuse(`${label} exact manifest names a different package`);
  }
  if (manifest.version !== undefined && manifest.version !== source.version) {
    return refuse(`${label} exact manifest reports a different version`);
  }
  const dist = manifest.dist;
  if (dist === null || typeof dist !== 'object' || Array.isArray(dist)) {
    return refuse(`${label} packument exact version lacks dist evidence`);
  }
  if (dist.integrity !== source.integrity) {
    return refuse(`${label} packument integrity does not match the canonical source`);
  }
  if (typeof dist.tarball !== 'string') {
    return refuse(`${label} packument exact version lacks a tarball URL`);
  }
  try {
    const url = new URL(dist.tarball);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http');
    return { ok: true, tarballUrl: url.href };
  } catch {
    return refuse(`${label} packument tarball URL is not absolute http(s)`);
  }
}

function sourceResponse(record, source) {
  return {
    source,
    url: record.url,
    protocol: record.protocol,
    bodyBytes: record.bodyBytes,
    complete: record.complete,
    fromDiskCache: record.fromDiskCache,
    fromServiceWorker: record.fromServiceWorker,
  };
}

/**
 * Turn raw CDP bodies into the exact standard source response list. Successful
 * packument bytes independently prove the tarball URL and canonical SRI;
 * retries and incomplete redirects remain in the returned byte ledger.
 */
export function finalizeStandardAssetSourceResponses({ registryUrl, source, captured }) {
  if (!validSource(source)) throw new TypeError('standard asset source descriptor is invalid');
  if (!Array.isArray(captured)) throw new TypeError('captured CDP responses must be an array');
  const label = `${source.name}@${source.version}`;
  const expectedPackumentUrl = packumentUrl(registryUrl, source.name);
  const packuments = captured.filter((record) => record?.url === expectedPackumentUrl);
  if (packuments.length === 0) {
    return refuse(`${label} has no exact standard packument response`);
  }

  const tarballUrls = new Set();
  for (const record of packuments) {
    if (!successfulPackument(record)) continue;
    const decoded = decodedPackument(record, label);
    if (!decoded.ok) return decoded;
    const dist = exactDist(decoded.value, source, label);
    if (!dist.ok) return dist;
    tarballUrls.add(dist.tarballUrl);
  }
  if (tarballUrls.size === 0) {
    return refuse(`${label} has no complete successful exact packument response`);
  }
  if (tarballUrls.size !== 1) {
    return refuse(`${label} successful packuments disagree on tarball URL`);
  }
  const [expectedTarballUrl] = tarballUrls;
  const tarballs = captured.filter((record) => record?.url === expectedTarballUrl);
  if (tarballs.length === 0) return refuse(`${label} has no exact tarball response`);

  return {
    ok: true,
    sourceResponses: captured.flatMap((record) => {
      if (record?.url === expectedPackumentUrl) return [sourceResponse(record, 'packument')];
      if (record?.url === expectedTarballUrl) return [sourceResponse(record, 'tarball')];
      return [];
    }),
  };
}
