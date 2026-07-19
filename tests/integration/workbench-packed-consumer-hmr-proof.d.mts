export interface PackedConsumerHmrProof {
  readonly expectedSentinel: string;
  readonly sentinel: string | null;
  readonly beforeUnload: string | null;
  readonly messages: readonly unknown[];
}

export function assertPackedConsumerHmrProof(proof: PackedConsumerHmrProof): void;
