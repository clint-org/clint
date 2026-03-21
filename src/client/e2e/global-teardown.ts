import { createClient } from '@supabase/supabase-js';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const STORAGE_PATH = join(__dirname, '.auth-storage.json');

async function globalTeardown() {
  if (!existsSync(STORAGE_PATH)) return;

  const supabaseUrl = process.env['SUPABASE_URL'] || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!serviceRoleKey) return;

  try {
    const storage = JSON.parse(readFileSync(STORAGE_PATH, 'utf-8'));
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await supabase.auth.admin.deleteUser(storage.userId);
  } finally {
    unlinkSync(STORAGE_PATH);
  }
}

export default globalTeardown;
