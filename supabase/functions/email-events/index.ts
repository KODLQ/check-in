import { createClient } from 'npm:@supabase/supabase-js@2';

import { handleEmailEvent } from './handler.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!secret) return new Response('Not configured', { status: 500 });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return handleEmailEvent(req, {
    secret,
    forgetAddress: async (providerMessageId) => {
      const { data, error } = await admin.rpc('email_bounced', { p_provider_message_id: providerMessageId });
      if (error) throw new Error(error.message);
      return data === true;
    },
  });
});
