import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string)?.trim() || '';
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string)?.trim() || '';

export const supabase: SupabaseClient | null =
  url.length > 0 && anonKey.length > 0 ? createClient(url, anonKey) : null;
