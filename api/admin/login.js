import { createClient } from '@supabase/supabase-js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const EXPECTED_HOSTNAME = 'otbasu.vercel.app';
const EXPECTED_ACTION = 'admin_login';

function send(res, statusCode, payload) {
  res.status(statusCode);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return String(forwarded[0] || '').trim();
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return String(req.headers['x-real-ip'] || req.socket?.remoteAddress || '').trim();
}

export async function validateTurnstileToken({
  token,
  secret,
  remoteIp = '',
  expectedHostname = EXPECTED_HOSTNAME,
  expectedAction = EXPECTED_ACTION,
  fetchImpl = fetch
}) {
  if (!token || token.length > 2048 || !secret) {
    return { success: false, reason: 'invalid-input' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const payload = {
      secret,
      response: token
    };

    if (remoteIp) payload.remoteip = remoteIp;

    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) return { success: false, reason: 'siteverify-http-error' };

    const result = await response.json();
    const success = Boolean(
      result.success &&
      result.hostname === expectedHostname &&
      result.action === expectedAction
    );

    return {
      success,
      reason: success ? '' : 'siteverify-rejected',
      errorCodes: Array.isArray(result['error-codes']) ? result['error-codes'] : []
    };
  } catch {
    return { success: false, reason: 'siteverify-unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

export function isTurnstileProtectionEnabled({ secret, siteKey }) {
  return Boolean(secret && siteKey);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  const turnstileSiteKey = process.env.VITE_TURNSTILE_SITE_KEY;
  const turnstileEnabled = isTurnstileProtectionEnabled({
    secret: turnstileSecret,
    siteKey: turnstileSiteKey
  });

  if (!supabaseUrl || !anonKey) {
    return send(res, 503, { error: 'Сервер входа ещё не настроен.' });
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const turnstileToken = String(body.turnstileToken || '');

  if (!email || !password || (turnstileEnabled && !turnstileToken)) {
    return send(res, 400, { error: 'Заполни форму и пройди проверку безопасности.' });
  }

  if (turnstileEnabled) {
    const verification = await validateTurnstileToken({
      token: turnstileToken,
      secret: turnstileSecret,
      remoteIp: clientIp(req)
    });

    if (!verification.success) {
      return send(res, 403, { error: 'Проверка безопасности не пройдена. Попробуй ещё раз.' });
    }
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  const { data, error } = await authClient.auth.signInWithPassword({ email, password });

  if (error || !data?.session?.access_token || !data?.session?.refresh_token) {
    return send(res, 401, { error: 'Неверный email или пароль.' });
  }

  return send(res, 200, {
    ok: true,
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    }
  });
}
