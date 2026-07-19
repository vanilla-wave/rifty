function callable(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

/** A measured result is valid only after the browser that produced it closes. */
export async function withMeasuredBrowser(launchInput, measureInput) {
  const launch = callable(launchInput, 'browser launch');
  const measure = callable(measureInput, 'browser measurement');
  const browser = await launch();
  if (browser === null || typeof browser !== 'object' || typeof browser.close !== 'function') {
    throw new TypeError('browser launch must return a closeable browser');
  }

  let value;
  let measurementFailed = false;
  let measurementFailure;
  try {
    value = await measure(browser);
  } catch (error) {
    measurementFailed = true;
    measurementFailure = error;
  }

  let closeFailed = false;
  let closeFailure;
  try {
    await browser.close();
  } catch (error) {
    closeFailed = true;
    closeFailure = error;
  }

  if (measurementFailed && closeFailed) {
    throw new AggregateError(
      [measurementFailure, closeFailure],
      'browser measurement and teardown both failed',
    );
  }
  if (measurementFailed) throw measurementFailure;
  if (closeFailed) throw closeFailure;
  return value;
}
