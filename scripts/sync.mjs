// Sync the whole Asana workspace into Supabase (mis_tasks + mis_meta).
//
// Local:   npm run sync           (loads .env.local automatically)
// CI:      node scripts/sync.mjs  (env vars provided by GitHub Actions)
//
// Takes several minutes for large workspaces (Asana rate limits).

import { createClient } from "@supabase/supabase-js";
import { fetchWorkspaceData } from "../lib/asana.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const token = process.env.ASANA_TOKEN;

if (!url || !key) {
  console.error("✗ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!token || token.startsWith("paste")) {
  console.error("✗ Missing ASANA_TOKEN");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

console.log("→ Fetching the whole Asana workspace (this can take several minutes)…");
const t0 = Date.now();
const d = await fetchWorkspaceData(token, process.env.ASANA_WORKSPACE_GID || "");
console.log(
  `→ Fetched ${d.tasks.length} tasks, ${d.members.length} members in ${((Date.now() - t0) / 1000).toFixed(0)}s`
);

const runStart = new Date().toISOString();

// A task can belong to several projects (multi-homed), so the same gid can
// appear more than once. Keep one row per gid — Postgres upsert cannot touch
// the same primary key twice in a single batch.
const byGid = new Map();
for (const t of d.tasks) {
  if (!byGid.has(t.gid)) {
    byGid.set(t.gid, {
      gid: t.gid,
      name: t.name,
      assignee: t.assignee,
      project: t.project,
      section: t.section,
      completed: t.completed,
      completed_at: t.completed_at,
      created_at: t.created_at,
      due_on: t.due_on,
      synced_at: runStart,
    });
  }
}
const rows = [...byGid.values()];
console.log(`→ ${rows.length} unique tasks after de-duplicating multi-project tasks`);

const CHUNK = 500;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const { error } = await sb.from("mis_tasks").upsert(chunk, { onConflict: "gid" });
  if (error) {
    console.error("✗ Upsert error:", error.message);
    process.exit(1);
  }
  console.log(`  upserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
}

// Remove tasks that no longer exist in Asana (not touched this run)
const { error: delErr } = await sb.from("mis_tasks").delete().lt("synced_at", runStart);
if (delErr) console.error("⚠ cleanup error:", delErr.message);

// Save member roster + last-synced time
await sb
  .from("mis_meta")
  .upsert({ key: "members", value: JSON.stringify(d.members), updated_at: runStart }, { onConflict: "key" });
await sb
  .from("mis_meta")
  .upsert({ key: "last_synced", value: runStart, updated_at: runStart }, { onConflict: "key" });

console.log(`✅ Sync complete in ${((Date.now() - t0) / 1000).toFixed(0)}s. Last synced: ${runStart}`);
