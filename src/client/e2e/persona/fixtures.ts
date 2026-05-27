import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';

const CDP_URL = process.env['CDP_URL'] || 'http://localhost:9222';

type PersonaFixtures = {
  cdpPage: Page;
  cdpContext: BrowserContext;
};

export const test = base.extend<PersonaFixtures>({
  cdpContext: async ({}, use) => {
    const browser = await chromium.connectOverCDP(CDP_URL);
    const contexts = browser.contexts();
    const context = contexts[0] || await browser.newContext();
    await use(context);
  },

  cdpPage: async ({ cdpContext }, use) => {
    const page = await cdpContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
