// Deletes the calling user's account (spec: user-accounts / Account deletion). Owned groups are handed over
// first (pass_on_owned_groups); the profiles trigger repeats that as a safety net.
// Database rows cascade from auth.users -> profiles -> events -> invites/rsvps/co-hosts, and the user's
// own co-host memberships are removed while events they only co-host stay (add-co-hosts).
// Storage objects don't cascade, so we remove the user's folders explicitly: their own covers/avatars
// and the event folders (covers/e/<event id>/) of events they OWN. Event folders of events they only
// co-host are left alone, so a co-host deleting their account never breaks the owner's cover.
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

  // Groups the user owns (with their series' dates) pass to the longest-standing admin, else member, first
  // (add-groups-and-recurring-events). Those dates are no longer "owned" below, so their covers stay.
  const { error: passError } = await admin.rpc('pass_on_owned_groups', { p_user_id: userId });
  if (passError) return new Response(JSON.stringify({ error: passError.message }), { status: 500, headers: cors });

  const { data: owned, error: ownedError } = await admin.from('events').select('id').eq('host_id', userId);
  if (ownedError) return new Response(JSON.stringify({ error: ownedError.message }), { status: 500, headers: cors });
  for (const { id } of owned ?? []) {
    const folder = `e/${id}`;
    const { data: files } = await admin.storage.from('covers').list(folder, { limit: 1000 });
    if (files?.length) {
      await admin.storage.from('covers').remove(files.map((f) => `${folder}/${f.name}`));
    }
  }

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
