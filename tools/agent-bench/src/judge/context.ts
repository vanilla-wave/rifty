import type { Frame, Page } from '@playwright/test';
export interface JudgeContext {
  view: Frame | Page;
  previewUrl: string;
}
export interface JudgeProbe {
  name: string;
  pass: boolean;
  evidence: unknown;
}
export interface JudgeVerdict {
  pass: boolean;
  probes: JudgeProbe[];
}
export type TaskJudge = (context: JudgeContext) => Promise<JudgeVerdict>;
export function verdict(probes: JudgeProbe[]): JudgeVerdict {
  return { pass: probes.length > 0 && probes.every((probe) => probe.pass), probes };
}
export async function issues({ view }: JudgeContext) {
  await view.getByRole('link', { name: 'Issues', exact: true }).click();
  await view.getByRole('heading', { name: 'Issues', exact: true }).waitFor();
}
export async function ids({ view }: JudgeContext): Promise<number[]> {
  return view
    .locator('.issue-card')
    .evaluateAll((nodes) =>
      nodes.map((node) =>
        Number(node.querySelector('.issue-card__id')?.textContent?.replace('#', '')),
      ),
    );
}
