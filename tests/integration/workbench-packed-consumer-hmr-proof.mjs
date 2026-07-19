function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function isExpectedNativeUpdate(payload) {
  if (!isRecord(payload) || payload.type !== 'update' || !Array.isArray(payload.updates)) {
    return false;
  }
  return payload.updates.some(
    (update) =>
      isRecord(update) &&
      update.path === '/src/main.ts' &&
      update.acceptedPath === '/src/message.ts',
  );
}

export function assertPackedConsumerHmrProof(proof) {
  if (proof.sentinel !== proof.expectedSentinel) {
    throw new Error('Packed Workbench HMR replaced the preview document');
  }
  if (proof.beforeUnload !== null) {
    throw new Error('Packed Workbench HMR fired beforeunload');
  }
  if (!proof.messages.some(isExpectedNativeUpdate)) {
    throw new Error(
      `Packed Workbench missed Vite's native dependency update: ${JSON.stringify(proof.messages)}`,
    );
  }
}
