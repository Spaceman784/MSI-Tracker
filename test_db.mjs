import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log("URL:", url);
console.log("Key length:", key ? key.length : 0);

if (!url || !key) {
  console.error("Missing SUPABASE env vars");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function run() {
  console.log("Querying mis_tasks count...");
  const t0 = Date.now();
  try {
    const { count, error } = await sb
      .from("mis_tasks")
      .select("*", { count: "exact", head: true });
    if (error) {
      console.error("Supabase Error:", error);
    } else {
      console.log(`Count: ${count} rows (took ${Date.now() - t0}ms)`);
    }
  } catch (err) {
    console.error("Connection/Fetch Error:", err);
  }
}

run();
