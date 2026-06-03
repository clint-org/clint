import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import { join } from 'path';

const STORAGE_PATH = join(__dirname, '.auth-storage.json');

async function globalSetup() {
  const supabaseUrl = process.env['SUPABASE_URL'] || 'http://127.0.0.1:54321';
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Unique email per run. Previously a hardcoded address paired with an
  // optimistic deleteUser() that fails silently when the prior run left
  // FK-bound rows behind (markers.created_by, materials.uploaded_by,
  // primary_intelligence.last_edited_by all NOT NULL NO ACTION). The
  // cascade-safety redact_user RPC is the proper long-term fix.
  const email = `e2e-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@clint.local`;
  const password = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let createData: Awaited<ReturnType<typeof supabase.auth.admin.createUser>>['data'] = { user: null };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    const result = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (!result.error) { createData = result.data; break; }
    if (attempt === 4) throw result.error;
  }

  const anonKey =
    process.env['SUPABASE_ANON_KEY'] || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let signInData: Awaited<ReturnType<typeof anonClient.auth.signInWithPassword>>['data'] = { user: null as never, session: null };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    const result = await anonClient.auth.signInWithPassword({ email, password });
    if (!result.error) { signInData = result.data; break; }
    if (attempt === 4) throw result.error;
  }

  const storage = {
    userId: signInData.user.id,
    email,
    accessToken: signInData.session!.access_token,
    refreshToken: signInData.session!.refresh_token,
    expiresAt: signInData.session!.expires_at,
  };

  writeFileSync(STORAGE_PATH, JSON.stringify(storage, null, 2));
}

export default globalSetup;
