export interface PackageTreeIdentity {
  readonly root: string;
  readonly slug: string;
}

export class PackageTreeUnattestedError extends Error {
  readonly code = 'EUNATTESTEDPACKAGETREE' as const;

  constructor(project: PackageTreeIdentity) {
    super(`package tree is unattested for ${project.slug} at ${project.root}`);
    this.name = 'PackageTreeUnattestedError';
  }
}
