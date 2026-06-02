import { getSupabase } from "./supabase";

let cache = { at: 0, data: null };
const TTL = 5 * 60 * 1000; // 5 minutes

/** Load the full task set + member roster from Supabase (cached). */
export async function getDataset(force = false) {
  if (!force && cache.data && Date.now() - cache.at < TTL) return cache.data;

  const sb = getSupabase();
  if (!sb) throw new Error("NO_SUPABASE");

  const tasks = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("mis_tasks")
      .select("gid,name,assignee,project,section,completed,completed_at,created_at,due_on")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    tasks.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  const { data: meta } = await sb.from("mis_meta").select("key,value");
  const metaMap = Object.fromEntries((meta || []).map((m) => [m.key, m.value]));
  let members = [];
  try {
    members = JSON.parse(metaMap.members || "[]");
  } catch {
    members = [];
  }

  const data = { tasks, members, lastSynced: metaMap.last_synced || null };
  cache = { at: Date.now(), data };
  return data;
}

export function clearDatasetCache() {
  cache = { at: 0, data: null };
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Full dropdown option lists (computed from the entire dataset). */
export function buildFilterLists(dataset) {
  const tasks = dataset.tasks;
  const assignees = new Set(tasks.map((t) => t.assignee));
  (dataset.members || []).forEach((m) => assignees.add(m));
  const projects = new Set(tasks.map((t) => t.project));
  const sections = new Set(tasks.map((t) => t.section));
  return {
    assignees: ["All", ...Array.from(assignees).filter(Boolean).sort()],
    projects: ["All", ...Array.from(projects).filter(Boolean).sort()],
    sections: ["All", ...Array.from(sections).filter(Boolean).sort()],
  };
}

/** Apply filters to the dataset, returning the matching tasks. */
export function filterTasks(dataset, p) {
  const today = todayStr();
  const q = (p.search || "").trim().toLowerCase();
  return dataset.tasks.filter((t) => {
    if (p.assignee && p.assignee !== "All" && t.assignee !== p.assignee) return false;
    if (p.project && p.project !== "All" && t.project !== p.project) return false;
    if (p.section && p.section !== "All" && t.section !== p.section) return false;
    const overdue = !t.completed && t.due_on && t.due_on < today;
    if (p.status === "Completed" && !t.completed) return false;
    if (p.status === "Open" && t.completed) return false;
    if (p.status === "Overdue" && !overdue) return false;
    if (p.from || p.to) {
      if (!t.due_on) return false;
      if (p.from && t.due_on < p.from) return false;
      if (p.to && t.due_on > p.to) return false;
    }
    if (q) {
      const hay = `${t.name} ${t.assignee} ${t.project} ${t.section}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Aggregate a filtered task list into KPIs + per-assignee + per-project. */
export function aggregate(filtered) {
  const today = todayStr();
  let completed = 0,
    open = 0,
    overdue = 0;
  const byA = {};
  const byP = {};
  for (const t of filtered) {
    if (!byA[t.assignee])
      byA[t.assignee] = { assignee: t.assignee, total: 0, completed: 0, pending: 0, overdue: 0 };
    const r = byA[t.assignee];
    r.total++;
    if (!byP[t.project]) byP[t.project] = { name: t.project, Total: 0, Completed: 0 };
    byP[t.project].Total++;
    if (t.completed) {
      completed++;
      r.completed++;
      byP[t.project].Completed++;
    } else {
      open++;
      r.pending++;
      if (t.due_on && t.due_on < today) {
        overdue++;
        r.overdue++;
      }
    }
  }
  const perAssignee = Object.values(byA)
    .map((r) => ({ ...r, pct: r.total ? Math.round((r.completed / r.total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
  const perProject = Object.values(byP).sort((a, b) => b.Total - a.Total).slice(0, 10);

  return {
    kpis: { total: filtered.length, completed, open, overdue },
    perAssignee,
    perProject,
  };
}
