import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

test('sealed Workbench fixture close preserves phase and nested failures across Playwright', async ({
  page,
}) => {
  await gotoHarness(page);

  let observed: unknown;
  try {
    await page.evaluate(async (fixtureUrl) => {
      const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as {
        throwSealedWorkbenchFixtureCloseFailures(
          failures: readonly {
            readonly phase: 'terminal.close' | 'project.close' | 'workbench.close';
            readonly error: unknown;
          }[],
        ): never;
      };
      fixture.throwSealedWorkbenchFixtureCloseFailures([
        {
          phase: 'project.close',
          error: new AggregateError(
            [
              new TypeError('session leaf'),
              new AggregateError(
                [new Error('nested leaf', { cause: new RangeError('nested cause') })],
                'nested aggregate',
              ),
            ],
            'project aggregate',
          ),
        },
        { phase: 'workbench.close', error: new Error('owner leaf') },
      ]);
    }, sealedWorkbenchFixtureUrl);
  } catch (error) {
    observed = error;
  }

  expect(observed).toBeInstanceOf(Error);
  const message = (observed as Error).message;
  expect(message).toContain('AggregateError: Sealed browser-unit Workbench fixture close failed');
  expect(message).toContain('"phase":"project.close"');
  expect(message).toContain('"name":"AggregateError","message":"project aggregate","errors"');
  expect(message).toContain('"name":"TypeError","message":"session leaf"');
  expect(message).toContain('"name":"AggregateError","message":"nested aggregate","errors"');
  expect(message).toContain('"name":"Error","message":"nested leaf","cause"');
  expect(message).toContain('"name":"RangeError","message":"nested cause"');
  expect(message).toContain('"phase":"workbench.close"');
  expect(message).toContain('"name":"Error","message":"owner leaf"');

  let singleObserved: unknown;
  try {
    await page.evaluate(async (fixtureUrl) => {
      const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as {
        throwSealedWorkbenchFixtureCloseFailures(
          failures: readonly {
            readonly phase: 'workbench.close';
            readonly error: unknown;
          }[],
        ): never;
      };
      fixture.throwSealedWorkbenchFixtureCloseFailures([
        { phase: 'workbench.close', error: new Error('single owner leaf') },
      ]);
    }, sealedWorkbenchFixtureUrl);
  } catch (error) {
    singleObserved = error;
  }

  expect(singleObserved).toBeInstanceOf(Error);
  const singleMessage = (singleObserved as Error).message;
  expect(singleMessage).toContain('Error: Sealed browser-unit Workbench fixture close failed');
  expect(singleMessage).not.toContain('AggregateError: Sealed browser-unit');
  expect(singleMessage).toContain('"phase":"workbench.close"');
  expect(singleMessage).toContain('"name":"Error","message":"single owner leaf"');
});

test('direct Workbench close preserves nested failures across Playwright', async ({ page }) => {
  await gotoHarness(page);

  let observed: unknown;
  try {
    await page.evaluate(async (fixtureUrl) => {
      const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as {
        throwDirectWorkbenchCloseFailure(error: unknown): never;
      };
      fixture.throwDirectWorkbenchCloseFailure(
        new AggregateError(
          [
            new TypeError('direct session leaf'),
            new Error('direct owner leaf', { cause: new RangeError('direct owner cause') }),
          ],
          'direct Workbench aggregate',
          { cause: new SyntaxError('direct aggregate cause') },
        ),
      );
    }, sealedWorkbenchFixtureUrl);
  } catch (error) {
    observed = error;
  }

  expect(observed).toBeInstanceOf(Error);
  const message = (observed as Error).message;
  expect(message).toContain('Error: Direct browser-unit Workbench close failed');
  expect(message).toContain('"phase":"workbench.close"');
  expect(message).toContain(
    '"name":"AggregateError","message":"direct Workbench aggregate","errors"',
  );
  expect(message).toContain('"name":"TypeError","message":"direct session leaf"');
  expect(message).toContain('"name":"Error","message":"direct owner leaf","cause"');
  expect(message).toContain('"name":"RangeError","message":"direct owner cause"');
  expect(message).toContain('"name":"SyntaxError","message":"direct aggregate cause"');
});
