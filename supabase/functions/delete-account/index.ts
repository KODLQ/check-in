// Deletes the calling user's account (spec: user-accounts / Account deletion).
// Database rows cascade from auth.users -> profiles -> events -> invites/rsvps.
// Storage objects don't cascade, so we remove the user's folders explicitly.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!jwt) return new Response('Unauthorized', { status: 401, headers: cors });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) return new Response('Unauthorized', { status: 401, headers: cors });
  const userId = userData.user.id;

  for (const bucket of ['covers', 'avatars']) {
    const { data: files } = await admin.storage.from(bucket).list(userId, { limit: 1000 });
    if (files?.length) {
      await admin.storage.from(bucket).remove(files.map((f) => `${userId}/${f.name}`));
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });

  return new Response(JSON.stringify({ deleted: true }), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
