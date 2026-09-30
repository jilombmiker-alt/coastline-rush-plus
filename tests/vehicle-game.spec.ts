import { test, expect } from '@playwright/test';

test('garage changes the real car, keeps independent records, and restores the selection', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('vehicle-test-initialized')) {
      localStorage.setItem('other-game-vehicle-v1', 'gale');
      localStorage.setItem('coastline-rush-best-easy-tide', '130');
      localStorage.setItem('coastline-rush-best-easy-reef', '95');
      localStorage.setItem('coastline-rush-best-hard-reef', '98');
      localStorage.setItem('vehicle-test-initialized', 'true');
    }
  });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('input[name="vehicle"]')).toHaveCount(5);
  await expect(page.locator('input[name="vehicle"][value="tide"]')).toBeChecked();
  await expect(page.locator('#vehicle-name')).toHaveText('浪潮07');
  await expect(page.locator('#personal-best')).toHaveText('02:10.00');

  for (const [id, name, trait] of [
    ['reef', '珊瑚12', '起步轻快'],
    ['gale', '海风21', '更高极速'],
    ['tide', '浪潮07', '均衡动力'],
  ]) {
    await page.locator(`input[name="vehicle"][value="${id}"]`).check();
    await expect(page.locator('body')).toHaveAttribute('data-vehicle', id);
    await expect(page.locator('#vehicle-name')).toHaveText(name);
    await expect(page.locator('#vehicle-description')).toContainText(trait);
    await expect.poll(() => page.evaluate(() => {
      const game = (window as any).__RALLY__;
      const player = game.simulation.state.racers[0];
      const car = game.renderer.cars.get(0);
      let matchesPaint = false;
      car?.traverse((part: any) => {
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        matchesPaint ||= materials.some((material: any) => material?.color?.getHex() === player.color);
      });
      return matchesPaint;
    })).toBe(true);
    expect(await page.evaluate(() => (window as any).__RALLY__.simulation.getVehicle())).toBe(id);
    expect(await page.evaluate(() => (window as any).__RALLY__.simulation.state.racers[0].name)).toBe(name);
  }

  await page.locator('input[name="vehicle"][value="gale"]').check();
  await expect(page.locator('#personal-best')).toHaveText('等待你的第一条纪录');
  await page.locator('input[name="vehicle"][value="reef"]').check();
  await expect(page.locator('#best-label')).toHaveText('晴湾环岛 · 娱乐 · 简单 · 珊瑚12最佳');
  await expect(page.locator('#personal-best')).toHaveText('01:35.00');
  await page.locator('input[name="difficulty"][value="hard"]').check();
  await expect(page.locator('#best-label')).toHaveText('晴湾环岛 · 娱乐 · 困难 · 珊瑚12最佳');
  await expect(page.locator('#personal-best')).toHaveText('01:38.00');
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('input[name="vehicle"][value="reef"]')).toBeChecked();
  await expect(page.locator('#vehicle-name')).toHaveText('珊瑚12');
  await expect(page.locator('#personal-best')).toHaveText('01:38.00');
  expect(await page.evaluate(() => localStorage.getItem('coastline-rush-vehicle-v1'))).toBe('reef');
  expect(await page.evaluate(() => localStorage.getItem('other-game-vehicle-v1'))).toBe('gale');
  await page.screenshot({ path: 'test-results/garage-reef.png' });

  await page.locator('#start-button').click();
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'countdown');
  for (const id of ['tide', 'reef', 'gale']) {
    await expect(page.locator(`input[name="vehicle"][value="${id}"]`)).toBeDisabled();
    expect(await page.evaluate(id => (window as any).__RALLY__.simulation.setVehicle(id), id)).toBe(false);
  }
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'racing');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as any).__RALLY__.simulation.setVehicle('gale'))).toBe(false);
  await page.locator('#restart-button').click();
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'countdown');
  expect(await page.evaluate(() => (window as any).__RALLY__.simulation.state.vehicle)).toBe('reef');
  await page.keyboard.press('Escape');
  await page.locator('#lobby-button').click();
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'menu');
  await expect(page.locator('input[name="vehicle"][value="reef"]')).toBeChecked();
  await page.locator('input[name="vehicle"][value="gale"]').check();
  await expect(page.locator('#vehicle-name')).toHaveText('海风21');
  expect(errors).toEqual([]);
});

test('garage radios support keyboard selection without starting the race', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden();
  await page.locator('input[name="vehicle"][value="tide"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('input[name="vehicle"][value="reef"]')).toBeChecked();
  await expect(page.locator('#vehicle-name')).toHaveText('珊瑚12');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('input[name="vehicle"][value="gale"]')).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('input[name="vehicle"][value="reef"]')).toBeChecked();
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'menu');
});
