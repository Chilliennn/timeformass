/* eslint-env node */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env.');
  process.exit(1);
}

const adminClient = createClient(url, serviceKey);

async function run() {
  try {
    const { data: admins, error } = await adminClient.from('admin').select('*');
    if (error) throw error;
    console.log(`Found ${admins.length} admins`);

    for (const a of admins) {
      if (a.auth_uid) {
        console.log(`Skip ${a.email} (already has auth_uid)`);
        continue;
      }

      // Fetch existing Auth user by email
      const { data: { users }, error: fetchErr } = await adminClient.auth.admin.listUsers();
      if (fetchErr) {
        console.error(`Failed to list users:`, fetchErr);
        continue;
      }

      const authUser = users.find(u => u.email === a.email);
      if (!authUser) {
        console.warn(`No Auth user found for ${a.email}, skipping`);
        continue;
      }

      const uid = authUser.id;
      console.log(`Found existing auth user ${a.email} uid=${uid}`);

      // Update admin table with auth_uid
      const { error: updErr } = await adminClient
        .from('admin')
        .update({ auth_uid: uid })
        .eq('admin_id', a.admin_id);

      if (updErr) {
        console.error(`Failed update admin row for ${a.email}:`, updErr);
      } else {
        console.log(`Updated admin row for ${a.email} with auth_uid`);
      }
    }

    console.log('Migration finished');
  } catch (err) {
    console.error('Migration error', err);
  }
}

run();