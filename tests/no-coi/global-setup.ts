/**
 * no-COI lane globalSetup: build the real shim artifacts (esbuild of the prod
 * sources) into `fixtures/dist/` before any spec runs. The webServer (started
 * earlier by Playwright) serves them statically.
 */
import { buildNoCoiFixtures } from './build-fixtures.mjs';

export default async function globalSetup(): Promise<void> {
  await buildNoCoiFixtures();
}
