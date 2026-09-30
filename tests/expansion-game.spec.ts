import { test, expect } from '@playwright/test';

test('six scene routes, five cars and both modes switch without leaving stale world geometry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('input[name="vehicle"]')).toHaveCount(5);

  for (const [track, name] of [['storm', '赤霞风暴'], ['neon', '霓虹夜港'], ['ridge', '云岭盘山'],
    ['coral', '珊瑚群岛'], ['aurora', '极光长湾'], ['bay', '晴湾环岛']] as const) {
    await page.locator('#track-select').selectOption(track);
    await expect(page.locator('#track-title')).toHaveText(name);
    await expect(page.locator('#hud-track-name')).toHaveText(name);
    await expect(page.locator('#viewport canvas')).toHaveCount(1);
    expect(await page.evaluate(() => (window as any).__RALLY__.simulation.state.track)).toBe(track);
  }

  await page.locator('input[name="vehicle"][value="pulse"]').check();
  await expect(page.locator('#vehicle-name')).toHaveText('脉冲33');
  await page.locator('#track-select').selectOption('neon');
  await page.locator('#mode-select').selectOption('speed');
  await expect(page.locator('#item-panel')).toBeHidden();
  await expect(page.locator('.nitro-track')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__RALLY__.simulation.state.pickups.length)).toBe(0);
  await page.getByRole('button', { name: '开始比赛' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'racing');
  await page.keyboard.down('w');
  await expect.poll(() => page.evaluate(() => (window as any).__RALLY__.simulation.state.racers[0].speed)).toBeGreaterThan(20);
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  await page.locator('#lobby-button').click();
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'menu');

  await page.locator('#track-select').selectOption('storm');
  await page.locator('#mode-select').selectOption('party');
  expect(await page.locator('#item-panel').evaluate(element => (element as HTMLElement).hidden)).toBe(false);
  expect(await page.evaluate(() => (window as any).__RALLY__.simulation.state.pickups.length)).toBeGreaterThan(0);
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});
