// The probe plan (shared by the Node oracle and the Workbench spec). @TMP@ = the host's tmp dir.
export const plan = [];
for (const mib of [4, 16])
  for (const run of [1, 2, 3]) plan.push({ case: 'read', mib, run, argv: ['read', String(mib)] });
for (const mib of [4, 16])
  for (const run of [1, 2, 3]) plan.push({ case: 'write', mib, run, argv: ['write', String(mib)] });
plan.push({ case: 'setup-1000-files', mib: 0, run: 1, argv: ['many', '1000'] });
for (const run of [1, 2, 3])
  plan.push({
    case: 'write-bigproject-root',
    mib: 16,
    run,
    argv: ['write', '16', 'big-project.bin'],
  });
for (const run of [1, 2, 3])
  plan.push({
    case: 'write-bigproject-tmp',
    mib: 16,
    run,
    argv: ['write', '16', '@TMP@/nsg-big.bin'],
  });
