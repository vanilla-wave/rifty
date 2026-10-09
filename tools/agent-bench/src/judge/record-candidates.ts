import type { Locator } from '@playwright/test';
import { caption, workflowCandidates } from './context.ts';
import type { JudgeContext } from './context.ts';
import { publicReadOnlyText } from './public-record-display.ts';

/** Narrow candidates with caller data; this does not certify a saved record or operation. */
export async function recordCandidates(
  ctx: JudgeContext,
  verbs: string,
  subjects: string,
  identity: string,
  otherIdentities: readonly string[] = [],
): Promise<Locator> {
  const candidates = await workflowCandidates(ctx, verbs, subjects);
  const pattern = caption(identity);
  let result = ctx.view.locator('xpath=//*[false()]');
  for (const candidate of await candidates.all()) {
    if (
      await candidate
        .and(
          ctx.view
            .getByRole('button', { name: pattern })
            .or(ctx.view.getByRole('link', { name: pattern })),
        )
        .count()
    ) {
      result = result.or(candidate);
      continue;
    }
    for (const scope of (await candidate.locator('xpath=ancestor::*').all()).reverse()) {
      const text = await publicReadOnlyText(scope);
      if (!pattern.test(text)) continue;
      if (!otherIdentities.some((other) => caption(other).test(text)))
        result = result.or(candidate);
      // A broader ancestor cannot resolve this candidate more specifically.
      break;
    }
  }
  return result;
}
