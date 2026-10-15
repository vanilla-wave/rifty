import type { Locator } from '@playwright/test';

/** Native controls cannot represent every invalid literal; clear via real input events. */
export async function fillNativeInput(control: Locator, value: string) {
  const representable = await control.evaluate((node, raw) => {
    if (!(node instanceof HTMLInputElement) || !['date', 'time', 'number'].includes(node.type))
      return true;
    const probe = document.createElement('input');
    probe.type = node.type;
    probe.value = raw;
    return probe.value === raw;
  }, value);
  await control.fill(representable ? value : '');
}
