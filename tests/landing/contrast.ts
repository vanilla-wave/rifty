import type { Page } from '@playwright/test';

/** Minimum WCAG contrast ratio over every `selector` match; the background is composited up the ancestor chain over white. */
export async function minimumTextContrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluateAll((elements) => {
    type Color = { r: number; g: number; b: number; a: number };

    const parse = (value: string): Color => {
      const [r = 0, g = 0, b = 0, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
      return { r, g, b, a };
    };
    const over = (foreground: Color, background: Color): Color => {
      const a = foreground.a + background.a * (1 - foreground.a);
      if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
      return {
        r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / a,
        g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / a,
        b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / a,
        a,
      };
    };
    const opaqueBackground = (element: Element): Color => {
      const layers: Color[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) {
        layers.push(parse(getComputedStyle(current).backgroundColor));
      }
      return layers.reverse().reduce((background, layer) => over(layer, background), {
        r: 255,
        g: 255,
        b: 255,
        a: 1,
      });
    };
    const luminance = ({ r, g, b }: Color): number => {
      const [red = 0, green = 0, blue = 0] = [r, g, b].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };

    return Math.min(
      ...elements.map((element) => {
        const background = opaqueBackground(element);
        const foreground = over(parse(getComputedStyle(element).color), background);
        const dark = luminance(background);
        const light = luminance(foreground);
        return (Math.max(dark, light) + 0.05) / (Math.min(dark, light) + 0.05);
      }),
    );
  });
}
