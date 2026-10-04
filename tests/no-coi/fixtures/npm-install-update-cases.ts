export const updateCases = [
  { name: 'bare name refreshes retained pin', args: ['ms'], before: [['ms@2.0.0']], initial: {} },
  {
    name: 'explicit range refreshes retained pin',
    args: ['ms@^2.0.0'],
    before: [['ms@2.0.0']],
    initial: {},
  },
  { name: 'wildcard refreshes retained pin', args: ['ms@*'], before: [['ms@2.0.0']], initial: {} },
  {
    name: 'exact save refreshes retained pin',
    args: ['ms', '-E'],
    before: [['ms@2.0.0']],
    initial: {},
  },
  { name: 'no args retains pin', args: [], before: [['ms@2.0.0']], initial: {} },
  {
    name: 'other addition retains unrelated pin',
    args: ['kleur'],
    before: [['ms@2.0.0']],
    initial: {},
  },
  {
    name: 'missing optional exact version',
    args: ['ms'],
    before: [],
    initial: { optionalDependencies: { ms: '99.0.0' } },
  },
  {
    name: 'missing optional range',
    args: ['ms'],
    before: [],
    initial: { optionalDependencies: { ms: '^99.0.0' } },
  },
  {
    name: 'missing optional exact save',
    args: ['ms', '-E'],
    before: [],
    initial: { optionalDependencies: { ms: '99.0.0' } },
  },
  {
    name: 'missing optional alongside required addition',
    args: ['ms', 'kleur'],
    before: [],
    initial: { optionalDependencies: { ms: '99.0.0' } },
  },
  {
    name: 'optional tarball acquisition fails after resolution',
    args: ['ms'],
    before: [],
    initial: { optionalDependencies: { ms: '2.0.0' } },
    tarballFailure: true,
  },
] as const;
