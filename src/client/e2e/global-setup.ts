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

  const email = 'e2e-test@clint.local';
  const password = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // Clean up any existing test user first
  const { data: users } = await supabase.auth.admin.listUsers();
  const existing = users?.users.find((u) => u.email === email);
  if (existing) {
    await supabase.from('tenant_members').delete().eq('user_id', existing.id);
    await supabase.from('space_members').delete().eq('user_id', existing.id);
    await supabase.auth.admin.deleteUser(existing.id);
  }

  const { data: createData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError) throw createError;

  const anonKey =
    process.env['SUPABASE_ANON_KEY'] || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) throw signInError;

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
