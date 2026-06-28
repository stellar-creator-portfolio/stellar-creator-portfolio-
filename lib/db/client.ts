import { createClient } from '@supabase/supabase-js';
import { Database } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Client-side Supabase instance
// Only uses public anonymous key, safe for client-side use
export const supabaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey);
