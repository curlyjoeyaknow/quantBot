import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('should load the dashboard page', async ({ page }) => {
    await page.goto('/');
    
    // Check if the main heading is visible
    await expect(page.getByRole('heading', { name: /QuantBot Dashboard/i })).toBeVisible();
    
    // Check if tabs are visible
    await expect(page.getByRole('tab', { name: /Dashboard/i })).toBeVisible();
  });

  test('should navigate between tabs', async ({ page }) => {
    await page.goto('/');
    
    // Click on Caller History tab
    await page.getByRole('tab', { name: /Caller History/i }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
    
    // Click on Health tab
    await page.getByRole('tab', { name: /Health/i }).click();
    await expect(page.getByRole('tabpanel')).toBeVisible();
  });
});

