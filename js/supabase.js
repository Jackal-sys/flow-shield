// One shared Supabase client for the whole app.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
