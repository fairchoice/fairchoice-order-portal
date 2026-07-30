import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const mainSource = fs.readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
const supabaseSource = fs.readFileSync(
  new URL("./supabase.js", import.meta.url),
  "utf8",
);

test("missing Supabase configuration renders a clear startup error before App mounts", () => {
  assert.match(
    mainSource,
    /isSupabaseConfigured \? <App \/> : <SupabaseConfigurationError \/>/,
  );
  assert.match(mainSource, /role="alert"/);
  assert.match(mainSource, /VITE_SUPABASE_URL/);
  assert.match(mainSource, /VITE_SUPABASE_ANON_KEY/);
});

test("Supabase client remains nullable only when configuration validation fails", () => {
  assert.match(
    supabaseSource,
    /export const supabase = isSupabaseConfigured[\s\S]*\? createClient\([\s\S]*: null/,
  );
  assert.match(supabaseSource, /SUPABASE_URL\.startsWith\("https:\/\/"\)/);
  assert.match(supabaseSource, /SUPABASE_URL\.includes\("\.supabase\.co"\)/);
  assert.match(supabaseSource, /SUPABASE_ANON_KEY\.length > 20/);
});
