import { createClient } from '@supabase/supabase-js';

const jsonHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

function send(res, statusCode, payload) {
  res.status(statusCode).setHeader('Content-Type', jsonHeaders['Content-Type']);
  res.setHeader('Cache-Control', jsonHeaders['Cache-Control']);
  res.end(JSON.stringify(payload));
}

function getBearerToken(req) {
  const value = req.headers.authorization || req.headers.Authorization || '';
  const match = String(value).match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return send(res, 500, { error: 'Server Supabase environment variables are not configured' });
  }

  const token = getBearerToken(req);
  if (!token) return send(res, 401, { error: 'Missing access token' });

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return send(res, 401, { error: 'Invalid access token' });
  }

  const { data: requester, error: requesterError } = await adminClient
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (requesterError) return send(res, 500, { error: requesterError.message });
  if (!requester?.is_active || requester.role !== 'admin') {
    return send(res, 403, { error: 'Only active administrators can create users' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const fullName = String(body.fullName || body.full_name || '').trim();
  const role = ['admin', 'content_manager'].includes(body.role) ? body.role : 'content_manager';

  if (!validateEmail(email)) return send(res, 400, { error: 'Invalid email' });
  if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters' });

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      role
    }
  });

  if (createError) return send(res, 400, { error: createError.message });

  const userId = created?.user?.id;
  if (!userId) return send(res, 500, { error: 'Supabase did not return created user id' });

  const { error: profileError } = await adminClient.from('profiles').upsert({
    id: userId,
    email,
    full_name: fullName,
    role,
    is_active: true,
    updated_at: new Date().toISOString()
  });

  if (profileError) return send(res, 500, { error: profileError.message });

  return send(res, 200, {
    ok: true,
    user: {
      id: userId,
      email,
      full_name: fullName,
      role,
      is_active: true
    }
  });
}
