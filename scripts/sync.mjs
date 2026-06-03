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

// ---- "One-Time" classification ----------------------------------
// Default: a task is one-time if it lives in a board named "...One Time...".
// Overrides: people whose one-time work is in a differently-named board.
// (matched case-insensitively, trimmed)
const norm = (s) => String(s || "").trim().toLowerCase();
const ONE_TIME_OVERRIDES = {
  "vallabh sumanth": ["sumanth's work tracker"], // use ONLY these as his one-time
};
function isOneTime(assignee, projects) {
  const override = ONE_TIME_OVERRIDES[norm(assignee)];
  const projs = (projects || []).map(norm);
  if (override) return projs.some((p) => override.includes(p));
  return projs.some((p) => /one[ -]?time/.test(p));
}
// -----------------------------------------------------------------

// Tasks are already unique per gid (fetchWorkspaceData groups multi-homed
// tasks). Map to rows, keeping the full projects + sections lists. A safety
// de-dupe guards against any stray duplicate gid in one upsert batch.
const byGid = new Map();
for (const t of d.tasks) {
  if (!byGid.has(t.gid)) {
    byGid.set(t.gid, {
      gid: t.gid,
      name: t.name,
      assignee: t.assignee,
      project: t.project,
      projects: t.projects || (t.project ? [t.project] : []),
      section: t.section,
      sections: t.sections || (t.section ? [t.section] : []),
      completed: t.completed,
      completed_at: t.completed_at,
      created_at: t.created_at,
      due_on: t.due_on,
      is_one_time: isOneTime(t.assignee, t.projects || (t.project ? [t.project] : [])),
      synced_at: runStart,
    });
  }
}
const rows = [...byGid.values()];
console.log(`→ ${rows.length} unique tasks (multi-project tasks counted once)`);

// The one-time feature adds an `is_one_time` column. If it hasn't been created
// yet, sync WITHOUT it so the sync never fails. (Run supabase/functions.sql to enable.)
const probe = await sb.from("mis_tasks").select("is_one_time").limit(1);
if (probe.error && /is_one_time/i.test(probe.error.message)) {
  console.log("ℹ 'is_one_time' column not found — syncing without it. Run the SQL to enable one-time completion.");
  for (const r of rows) delete r.is_one_time;
}

// original_due_on: keep the FIRST-seen due date per task (for revision tracking).
// Preserve existing originals; new tasks get their current due date as the baseline.
const odProbe = await sb.from("mis_tasks").select("original_due_on").limit(1);
if (odProbe.error && /original_due_on/i.test(odProbe.error.message)) {
  console.log("ℹ 'original_due_on' column not found — skipping revision tracking. Run the SQL to enable.");
  for (const r of rows) delete r.original_due_on;
} else {
  const existing = new Map();
  let f = 0;
  for (;;) {
    const { data } = await sb.from("mis_tasks").select("gid,original_due_on").range(f, f + 999);
    if (!data || data.length === 0) break;
    for (const r of data) if (r.original_due_on) existing.set(r.gid, r.original_due_on);
    if (data.length < 1000) break;
    f += 1000;
  }
  for (const r of rows) r.original_due_on = existing.get(r.gid) || r.due_on;
  console.log(`→ revision baselines: ${existing.size} preserved, ${rows.length - existing.size} new`);
}

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

// Tasks not touched this run = removed from Asana since last sync.
// Log them to mis_changes (for the Activity feed) BEFORE deleting.
const { data: removedRows, error: selErr } = await sb
  .from("mis_tasks")
  .select("gid,name,assignee,project")
  .lt("synced_at", runStart);
if (selErr) console.error("⚠ removed-detect error:", selErr.message);
if (removedRows && removedRows.length) {
  const changeRows = removedRows.map((r) => ({
    gid: r.gid,
    name: r.name,
    assignee: r.assignee,
    project: r.project,
    action: "removed",
    at: runStart,
  }));
  for (let i = 0; i < changeRows.length; i += 500) {
    const { error } = await sb.from("mis_changes").insert(changeRows.slice(i, i + 500));
    if (error) {
      console.error("⚠ change-log error (is mis_changes table created?):", error.message);
      break;
    }
  }
  console.log(`→ logged ${changeRows.length} removed tasks`);
}

// Remove tasks that no longer exist in Asana
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
