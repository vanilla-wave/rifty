const mode = process.env.RIFTY_SMOKE_CHILD_FAULT;
let leakedChannel: MessageChannel | undefined;

if (mode === 'success') {
  process.stdout.write('RIFTY_RUNTIME_SMOKE_CHILD_OK\n');
} else if (mode === 'missing-marker') {
  process.stdout.write('child exited cleanly without the marker\n');
} else if (mode === 'marker-substring') {
  process.stdout.write('prefix-RIFTY_RUNTIME_SMOKE_CHILD_OK-suffix\n');
} else if (mode === 'cross-stream-marker') {
  process.stdout.write('RIFTY_RUNTIME_SMOKE_', () => {
    process.stderr.write('CHILD_OK\n');
  });
} else if (mode === 'large-output-marker') {
  process.stdout.write('x'.repeat(1_100_000), () => {
    process.stdout.write('\nRIFTY_RUNTIME_SMOKE_CHILD_OK\n');
  });
} else if (mode === 'large-output-nonzero') {
  process.exitCode = 7;
  process.stdout.write('x'.repeat(1_100_000), () => {
    process.stderr.write('\nterminal failure after bounded output\n');
  });
} else if (mode === 'nonzero') {
  process.stderr.write('child primary failure\n');
  process.exitCode = 7;
} else if (mode === 'marker-nonzero') {
  process.stdout.write('RIFTY_RUNTIME_SMOKE_CHILD_OK\n');
  process.stderr.write('child failed after marker\n');
  process.exitCode = 7;
} else if (mode === 'timeout') {
  process.stdout.write(`TIMEOUT_PID:${process.pid}\n`);
  setInterval(() => {}, 1_000);
} else if (mode === 'timeout-exit') {
  process.stdout.write(`TIMEOUT_PID:${process.pid}\n`);
  process.on('SIGTERM', () => {
    process.stderr.write('late exit 7 after timeout\n');
    process.exit(7);
  });
  setInterval(() => {}, 1_000);
} else if (mode === 'timeout-ignore-term') {
  process.stdout.write(`TIMEOUT_PID:${process.pid}\n`);
  process.on('SIGTERM', () => {
    process.stderr.write('ignored SIGTERM; waiting for SIGKILL\n');
  });
  setInterval(() => {}, 1_000);
} else if (mode === 'signal') {
  process.kill(process.pid, 'SIGTERM');
} else if (mode === 'marker-before-close') {
  leakedChannel = new MessageChannel();
  leakedChannel.port1.onmessage = () => {};
  leakedChannel.port1.start();
  process.stdout.write(`MARKER_LEAK_PID:${process.pid}\n`);
  process.stdout.write('RIFTY_RUNTIME_SMOKE_CHILD_OK\n');
} else {
  throw new Error(`unknown RIFTY_SMOKE_CHILD_FAULT: ${String(mode)}`);
}
