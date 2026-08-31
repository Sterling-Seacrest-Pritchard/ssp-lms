import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// `createClient` validates its arguments and throws synchronously if the URL
// is missing - Next.js's `next build` imports every route module to collect
// page data, and Cloud Run's Secret Manager-backed env vars are only present
// at container RUNTIME, never during the build step. Eagerly creating the
// client at module load broke the production build. This Proxy defers
// `createClient` until the storage client is actually used (a real request),
// by which point the runtime env vars are set. Function properties are bound
// to the real client so `this` inside supabase-js's own methods still works
// correctly when called as `supabaseStorage.from(...)`.
let cachedStorage: SupabaseClient["storage"] | undefined;

function getStorage(): SupabaseClient["storage"] {
  if (!cachedStorage) {
    cachedStorage = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    ).storage;
  }
  return cachedStorage;
}

export const supabaseStorage = new Proxy({} as SupabaseClient["storage"], {
  get(_target, prop) {
    const real = getStorage();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
