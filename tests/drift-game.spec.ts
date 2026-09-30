import { test, expect } from '@playwright/test';

test('drift key can be changed in the guide and the visible gauge responds in a bend', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  await page.getByRole('button', { name: '驾驶指南', exact: true }).click();
  await page.getByRole('combobox', { name: '漂移键' }).selectOption('KeyF');
  await expect(page.locator('#drift-key-help')).toHaveText('F');
  await page.keyboard.press('Escape');
  await expect(page.locator('#drift-key-footer')).toHaveText('F');
  await page.getByRole('button', { name: '开始比赛' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'racing');
  await page.evaluate(() => {
    const simulation = (window as any).__RALLY__.simulation;
    simulation.state.racers.slice(1).forEach((racer: any, i: number) => { racer.distance = 650 + i * 65; });
    Object.assign(simulation.state.racers[0], { distance: 25, lateral: 0, heading: 0, speed: 35 });
  });
  await page.keyboard.down('d');
  await page.keyboard.down('f');
  await expect.poll(() => page.evaluate(() => (window as any).__RALLY__.simulation.state.racers[0].driftTime)).toBeGreaterThan(0.12);
  await expect(page.locator('#drift-percent')).not.toHaveText('0%');
  await page.keyboard.up('f');
  await page.keyboard.up('d');
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#drift-key-footer')).toHaveText('F');
});
