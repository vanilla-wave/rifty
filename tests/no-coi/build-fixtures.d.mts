/** Types for the plain-JS builder shared with `tools/probes/no-coi-realm-probe.mjs`. */
export declare const FIXTURE_ENTRYPOINTS: Record<string, string>;
export declare function assertFixtureProvenance(metafile: unknown): void;
export declare function buildNoCoiFixtures(): Promise<string>;
