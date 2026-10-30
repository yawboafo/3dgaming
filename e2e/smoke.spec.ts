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
  // Server-driven pedestrians and traffic are synced to the client (the spawn zone's share).
  await expect.poll(() => page.evaluate(() => window.__town!.npcs().total)).toBe(20);
  expect(await page.evaluate(() => window.__town!.npcs().traffic)).toBeGreaterThan(0);
  // Strafe left along the pavement: straight ahead is the parked sedan.
  await page.keyboard.down('KeyA');
  await expect.poll(() => page.evaluate(() => window.__town!.locomotion())).toBe('walk');
  await page.waitForTimeout(1000);
  await page.keyboard.up('KeyA');
  // Standing again: the armed idle when the character model can hold a gun, plain idle on
  // placeholder art (CI has no models).
  await expect
    .poll(() => page.evaluate(() => window.__town!.locomotion()))
    .toMatch(/^(armed|idle)$/);

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

test('enters a car, drives it and gets out', async ({ page }) => {
  await joined(page);
  // The sedan is parked on the road just in front of the spawn.
  await page.keyboard.down('KeyW');
  await expect(page.getByTestId('interact-prompt')).toContainText('Drive', { timeout: 5000 });
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyE');
  await expect.poll(() => page.evaluate(() => window.__town!.vehicle())).not.toBe('');

  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => window.__town!.vehicleSpeed())).toBeGreaterThan(2);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS'); // brake
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyS');

  await page.keyboard.press('KeyE');
  await expect.poll(() => page.evaluate(() => window.__town!.vehicle())).toBe('');
  const out = await page.evaluate(() => window.__town!.pos()!);
  expect(out.y).toBeLessThan(0.5); // standing on the road, not on the seat
});
test('fires once and the server confirms the hit', async ({ page }) => {
  await joined(page);
  // Step clear of the parked sedan, then aim at the target across the road.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1800);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(300);
  // Aim at the centre of the nearest destructible prop that the parked sedan doesn't hide.
  const target = await page.evaluate(async () => {
    const p = window.__town!.pos()!;
    const town = (await (await fetch('/world/town.json')).json()) as {
      destructibles: { pos: number[]; center: number[] }[];
    };
    const visible = town.destructibles.filter((d) => d.pos[2]! < p.z - 5 && d.pos[0]! > 220);
    visible.sort((a, b) => Math.abs(a.pos[0]! - p.x) - Math.abs(b.pos[0]! - p.x));
    const d = visible[0]!;
    return [d.pos[0]!, d.pos[1]! + d.center[1]!, d.pos[2]!] as const;
  });
  await page.evaluate(([x, y, z]) => window.__town!.aimAt(x, y, z), target);
  const before = await page.evaluate(() => window.__town!.ammo().mag);

  await page.keyboard.press('KeyF');
  await expect.poll(() => page.evaluate(() => window.__town!.shotsFired())).toBe(1);
  // Hit confirmed by the server's own ray-cast, and ammo reconciled to the server's count.
  await expect.poll(() => page.evaluate(() => window.__town!.lastHit())).toMatch(/^prop:/);
  await expect.poll(() => page.evaluate(() => window.__town!.ammo().mag)).toBe(before - 1);
});

test('crosses a zone border and keeps playing in the next zone room', async ({ page }) => {
  await joined(page);
  const firstRoom = await page.evaluate(() => window.__town!.sessionId);
  // Sprint east along the pavement: the spawn zone ends at x = 256.
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyD');
  await expect
    .poll(
      () => page.evaluate(() => (window as unknown as { __handoffs: () => number }).__handoffs()),
      {
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(0);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('ShiftLeft');
  // A new room (new session id), the player carried over, and still moving under our control.
  await expect.poll(() => page.evaluate(() => window.__town!.sessionId)).not.toBe(firstRoom);
  const at = await page.evaluate(() => window.__town!.pos()!);
  expect(at.x).toBeGreaterThan(256);
  await page.keyboard.down('KeyD');
  await expect
    .poll(() => page.evaluate(() => window.__town!.pos()!.x), { timeout: 5000 })
    .toBeGreaterThan(at.x + 2);
  await page.keyboard.up('KeyD');
});
