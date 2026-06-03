const BASE = "https://app.asana.com/api/1.0";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function asanaGet(path, token, params = {}, attempt = 0) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  // Handle rate limiting (429) and transient server errors with backoff.
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    const wait = retryAfter ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 15000);
    await sleep(wait);
    return asanaGet(path, token, params, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Asana API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function getWorkspaces(token) {
  const d = await asanaGet("/workspaces", token, { limit: 100 });
  return d.data || [];
}

export async function getProjects(token, workspaceGid) {
  const projects = [];
  let offset;
  do {
    const params = {
      workspace: workspaceGid,
      limit: 100,
      opt_fields: "name,archived",
    };
    if (offset) params.offset = offset;
    const d = await asanaGet("/projects", token, params);
    projects.push(...(d.data || []));
    offset = d.next_page ? d.next_page.offset : undefined;
  } while (offset);
  return projects.filter((p) => !p.archived);
}

export async function getTasksForProject(token, projectGid) {
  const tasks = [];
  let offset;
  const opt =
    "name,completed,completed_at,created_at,due_on,due_at,assignee.name," +
    "memberships.section.name,memberships.project.name";
  do {
    const params = { limit: 100, opt_fields: opt };
    if (offset) params.offset = offset;
    const d = await asanaGet(`/projects/${projectGid}/tasks`, token, params);
    tasks.push(...(d.data || []));
    offset = d.next_page ? d.next_page.offset : undefined;
  } while (offset);
  return tasks;
}

export async function getWorkspaceUsers(token, workspaceGid) {
  const users = [];
  let offset;
  do {
    const params = { workspace: workspaceGid, limit: 100, opt_fields: "name" };
    if (offset) params.offset = offset;
    const d = await asanaGet("/users", token, params);
    users.push(...(d.data || []));
    offset = d.next_page ? d.next_page.offset : undefined;
  } while (offset);
  return users;
}

/** Run async workers over a list with limited concurrency. */
async function pool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length || 1) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/** Fetch the whole workspace and return a flat, dashboard-ready task list. */
export async function fetchWorkspaceData(token, pinnedWorkspaceGid) {
  const workspaces = await getWorkspaces(token);
  if (!workspaces.length) throw new Error("No Asana workspaces found for this token.");

  const wsGid = pinnedWorkspaceGid || workspaces[0].gid;
  const workspace = workspaces.find((w) => w.gid === wsGid) || workspaces[0];

  const projects = await getProjects(token, workspace.gid);

  // Full member roster (so everyone shows in the filter, even with 0 tasks)
  let members = [];
  try {
    members = (await getWorkspaceUsers(token, workspace.gid))
      .map((u) => u.name)
      .filter(Boolean);
  } catch (e) {
    // not fatal — fall back to assignees found on tasks
  }

  // A task can belong to several projects (multi-homed). We keep ONE record per
  // task gid and collect every project + section it appears in.
  // Paid Asana allows ~1,500 requests/min, so we fetch many projects at once.
  // (429 rate-limit responses are retried with backoff in asanaGet.)
  const CONCURRENCY = Number(process.env.ASANA_CONCURRENCY) || 16;
  const byGid = new Map();
  await pool(projects, CONCURRENCY, async (p) => {
    try {
      const tasks = await getTasksForProject(token, p.gid);
      for (const t of tasks) {
        const membership =
          (t.memberships || []).find((m) => m.project && m.project.gid === p.gid) ||
          (t.memberships || [])[0];
        const section = membership && membership.section ? membership.section.name : "No section";
        let rec = byGid.get(t.gid);
        if (!rec) {
          rec = {
            gid: t.gid,
            name: t.name || "(untitled task)",
            completed: Boolean(t.completed),
            completed_at: t.completed_at || null,
            created_at: t.created_at || null,
            due_on: t.due_on || (t.due_at ? t.due_at.slice(0, 10) : null),
            assignee: t.assignee && t.assignee.name ? t.assignee.name : "Unassigned",
            projects: [],
            sections: [],
            memberships: [], // [{ project, section }] — which section in which board
          };
          byGid.set(t.gid, rec);
        }
        if (p.name && !rec.projects.includes(p.name)) rec.projects.push(p.name);
        if (section && !rec.sections.includes(section)) rec.sections.push(section);
        rec.memberships.push({ project: p.name, section });
      }
    } catch (e) {
      // skip a project we can't read (permissions, etc.) but keep going
    }
  });

  const flat = [...byGid.values()].map((r) => ({
    ...r,
    project: r.projects[0] || "No project", // primary (for display fallback)
    section: r.sections[0] || "No section",
  }));

  return {
    workspace: workspace.name,
    workspaceGid: workspace.gid,
    fetchedAt: new Date().toISOString(),
    projects: projects.map((p) => p.name),
    members,
    tasks: flat,
  };
}
