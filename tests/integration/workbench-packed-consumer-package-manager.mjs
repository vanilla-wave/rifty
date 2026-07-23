export function installedPackagePackCommand(packageDirectory, tarballRoot, npmCacheRoot) {
  return {
    command: 'npm',
    args: ['pack', '--ignore-scripts', '--pack-destination', tarballRoot],
    options: {
      cwd: packageDirectory,
      timeoutMs: 120_000,
      env: {
        npm_config_cache: npmCacheRoot,
        npm_config_offline: 'true',
      },
    },
  };
}
