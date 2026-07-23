export function installedPackagePackPlan(
  packageDirectory,
  stagingDirectory,
  tarballRoot,
  npmCacheRoot,
) {
  return {
    copy: {
      source: packageDirectory,
      destination: stagingDirectory,
      options: {
        recursive: true,
        dereference: true,
      },
    },
    command: {
      command: 'npm',
      args: ['pack', '--loglevel=verbose', '--ignore-scripts', '--pack-destination', tarballRoot],
      options: {
        cwd: stagingDirectory,
        timeoutMs: 120_000,
        env: {
          npm_config_cache: npmCacheRoot,
          npm_config_offline: 'true',
        },
      },
    },
  };
}
