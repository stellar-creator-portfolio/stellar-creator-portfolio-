import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { Database } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Server-side Supabase instance with service role
// Bypasses Row Level Security (RLS) - MUST only be used on the server
export const supabaseServer = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);
