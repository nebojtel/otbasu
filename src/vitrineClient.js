import { PostgrestClient } from '@supabase/postgrest-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Public catalog requests do not need the admin auth, storage or realtime clients.
export const supabase = new PostgrestClient(`${supabaseUrl || 'https://example.supabase.co'}/rest/v1`, {
  headers: {
    apikey: supabaseAnonKey || 'missing-anon-key',
    'X-Client-Info': 'otbasy-vitrine'
  }
});

export function isConfigured() {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
