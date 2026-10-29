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
  // Spawn is mid-town, so the full 3×3 ring of chunks streams in.
  expect(await page.evaluate(() => window.__town!.chunks())).toBe(9);
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => window.__town!.locomotion())).toBe('walk');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyW');
  await expect.poll(() => page.evaluate(() => window.__town!.locomotion())).toBe('idle');

  await expect
    .poll(async () => {
      const now = await page.evaluate(() => window.__town!.pos()!);
      return Math.hypot(now.x - start.x, now.z - start.z);
    })
    .toBeGreaterThan(1);
});

test('enters a building with E and walks back out', async ({ page }) => {
  await joined(page);
  // Spawn is outside the first enterable building, facing away from its door.
  await expect(page.getByTestId('interact-prompt')).toContainText('Enter');
  await page.keyboard.press('KeyE');
  await expect.poll(() => page.evaluate(() => window.__town!.space())).not.toBe('town');
  const inside = await page.evaluate(() => window.__town!.pos()!);
  expect(inside.x).toBeGreaterThan(1500); // interiors live far from the town

  await page.keyboard.down('KeyS'); // back toward the exit door
  await expect(page.getByTestId('interact-prompt')).toContainText('Leave');
  await page.keyboard.up('KeyS');
  await page.keyboard.press('KeyE');
  await expect.poll(() => page.evaluate(() => window.__town!.space())).toBe('town');
  const out = await page.evaluate(() => window.__town!.pos()!);
  expect(out.x).toBeLessThan(500);
});

// Filled in by deliverables 4 and 5.
test.fixme('enters a car', async () => {});
test.fixme('fires once', async () => {});
