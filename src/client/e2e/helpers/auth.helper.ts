import { Browser, Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const STORAGE_PATH = join(__dirname, '..', '.auth-storage.json');

interface AuthStorage {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function getAuthStorage(): AuthStorage {
  return JSON.parse(readFileSync(STORAGE_PATH, 'utf-8'));
}

export async function authenticatedPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const auth = getAuthStorage();

  const supabaseUrl = process.env['SUPABASE_URL'] || 'http://127.0.0.1:54321';

  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // Supabase JS stores session with key: sb-{hostname-first-segment}-auth-token
  const hostname = new URL(supabaseUrl).hostname;
  const ref = hostname.split('.')[0];
  const storageKey = `sb-${ref}-auth-token`;

  const sessionData = {
    access_token: auth.accessToken,
    refresh_token: auth.refreshToken,
    expires_at: auth.expiresAt,
    token_type: 'bearer',
    user: {
      id: auth.userId,
      email: auth.email,
      aud: 'authenticated',
      role: 'authenticated',
    },
  };

  await page.evaluate(
    ([key, value]: [string, string]) => {
      localStorage.setItem(key, value);
    },
    [storageKey, JSON.stringify(sessionData)] as [string, string],
  );

  await page.goto('/', { waitUntil: 'networkidle' });

  return page;
}
