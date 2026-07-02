/**
 * Lane-agnostic entry into the previewed app. In the rifty lane the preview
 * lives under `/preview/<devPort>/` on the playground origin — an absolute
 * path like `page.goto('/issues')` would escape that prefix and miss the
 * service-worker route. Judges therefore always enter through `previewUrl`
 * and navigate IN-APP (real links, client-side routing), exactly like a user.
 */
import type { JudgeContext } from './context.ts';

export async function openPreview(ctx: JudgeContext): Promise<void> {
  await ctx.page.goto(ctx.previewUrl, { waitUntil: 'load' });
}

/** Enter the react-vite app and open /issues via the header nav link. */
export async function openIssuesPage(ctx: JudgeContext): Promise<void> {
  await openPreview(ctx);
  const nav = ctx.page.getByRole('link', { name: 'Issues', exact: true }).first();
  await nav.waitFor({ state: 'visible', timeout: 30_000 });
  await nav.click();
}
