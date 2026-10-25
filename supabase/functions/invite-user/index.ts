// Invites a person by email and assigns them to a supermarket.
// Authorization is decided by the database: the caller's own JWT is used to call
// can_manage_store_members() and upsert_store_member(), so this function cannot grant more than the caller may.
// The service-role key stays inside this function and is never sent to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not signed in' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401);

    const { store, email, full_name, role, max_discount } = await req.json();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '') || !['admin', 'stock_staff', 'cashier'].includes(role) || !store) {
      return json({ error: 'Enter a valid email and role' }, 400);
    }
    const { data: allowed, error: aErr } = await caller.rpc('can_manage_store_members', { p_store: store });
    if (aErr || !allowed) return json({ error: 'You are not allowed to add people to this supermarket' }, 403);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    let userId: string | undefined;
    const invited = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: full_name ?? '' },
      redirectTo: `${Deno.env.get('SITE_URL') ?? ''}/reset-password`,
    });
    if (invited.data?.user) userId = invited.data.user.id;
    else {
      // Already registered: look the account up instead of failing.
      for (let page = 1; page <= 20 && !userId; page++) {
        const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        userId = data?.users.find((u) => u.email?.toLowerCase() === String(email).toLowerCase())?.id;
        if (!data || data.users.length < 200) break;
      }
      if (!userId) return json({ error: invited.error?.message ?? 'Could not invite this email' }, 400);
    }
    const { error: mErr } = await caller.rpc('upsert_store_member', {
      p_store: store, p_user: userId, p_role: role, p_max_discount: role === 'cashier' ? Number(max_discount ?? 0) : 0,
    });
    if (mErr) return json({ error: mErr.message }, 400);
    return json({ ok: true, user_id: userId });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
