/** Legacy persisted selection model retained only as App presentation input. */
export type ActiveId = 'scratch' | string;

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly starter: string;
  readonly editedAt: string;
}

export interface Scratch {
  readonly starter: string;
  readonly dirty: boolean;
  readonly editedAt: string;
}

export interface ProjectIndex {
  readonly activeId: ActiveId;
  readonly scratch: Scratch | null;
  readonly projects: readonly Project[];
}

export function rootForId(activeId: ActiveId): string {
  return activeId === 'scratch' ? '/scratch' : `/projects/${activeId}`;
}
