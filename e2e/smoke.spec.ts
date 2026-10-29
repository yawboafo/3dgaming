import { expect, test, type Page } from '@playwright/test';

async function joined(page: Page) {
  await page.goto('/debug');
  await expect(page.locator('#status')).toContainText('Connected', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__town?.tick ?? 0)).toBeGreaterThan(0);
}

test('boots, joins a room and walks', async ({ page }) => {
  await joined(page);
  await expect(page.getByTestId('debug-overlay')).toContainText('draw calls');

  const start = await page.evaluate(() => window.__town!.pos()!);
  expect(Object.values(start).every(Number.isFinite)).toBe(true);
  expect(await page.evaluate(() => window.__town!.views())).toBeGreaterThan(0);
  await page.locator('canvas').click();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');

  await expect
    .poll(async () => {
      const now = await page.evaluate(() => window.__town!.pos()!);
      return Math.hypot(now.x - start.x, now.z - start.z);
    })
    .toBeGreaterThan(1);
});

// Filled in by deliverables 4 and 5.
test.fixme('enters a car', async () => {});
test.fixme('fires once', async () => {});
