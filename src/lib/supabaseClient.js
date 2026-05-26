import { createClient } from '@supabase/supabase-js';

const viteEnv = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
const nodeEnv = globalThis.process?.env;
const supabaseUrl = viteEnv?.VITE_SUPABASE_URL || nodeEnv?.SUPABASE_URL || nodeEnv?.VITE_SUPABASE_URL;
const supabaseAnonKey = viteEnv?.VITE_SUPABASE_ANON_KEY || nodeEnv?.SUPABASE_ANON_KEY || nodeEnv?.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
	throw new Error('Supabase environment variables are missing. Set SUPABASE_URL and SUPABASE_ANON_KEY for Node, or VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for Vite.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);