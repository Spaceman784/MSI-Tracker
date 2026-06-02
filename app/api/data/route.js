import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getDataset, buildFilterLists, filterTasks, aggregate } from "@/lib/store";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 200;

export async function GET(req) {
  const session = cookies().get(SESSION_COOKIE);
  if (!session || !verifySession(session.value)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const params = {
    search: sp.get("search") || "",
    assignee: sp.get("assignee") || "All",
    project: sp.get("project") || "All",
    section: sp.get("section") || "All",
    status: sp.get("status") || "All",
    from: sp.get("from") || "",
    to: sp.get("to") || "",
  };
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10));
  const format = sp.get("format");

  let dataset;
  try {
    dataset = await getDataset(sp.get("refresh") === "1");
  } catch (e) {
    if (String(e.message).includes("NO_SUPABASE")) {
      return NextResponse.json(
        {
          error: "NO_SUPABASE",
          message:
            "Supabase is not connected. Add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to .env.local, run the schema, then `npm run sync`.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "DB_ERROR", message: String(e.message) }, { status: 500 });
  }

  const filtered = filterTasks(dataset, params);

  // CSV export of the full filtered set
  if (format === "csv") {
    const headers = ["Task", "Assignee", "Project", "Section", "Status", "Due", "Completed At"];
    const today = new Date().toISOString().slice(0, 10);
    const lines = [headers.join(",")];
    for (const t of filtered) {
      const overdue = !t.completed && t.due_on && t.due_on < today;
      const status = t.completed ? "Completed" : overdue ? "Overdue" : "Open";
      const row = [t.name, t.assignee, t.project, t.section, status, t.due_on || "", t.completed_at || ""]
        .map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`)
        .join(",");
      lines.push(row);
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=napchief-mis-export.csv",
      },
    });
  }

  const agg = aggregate(filtered);
  const lists = buildFilterLists(dataset);
  const start = (page - 1) * PAGE_SIZE;
  const tasksPage = filtered.slice(start, start + PAGE_SIZE);

  return NextResponse.json({
    kpis: agg.kpis,
    perAssignee: agg.perAssignee,
    perProject: agg.perProject,
    tasks: tasksPage,
    page,
    pageSize: PAGE_SIZE,
    total: filtered.length,
    totalTasks: dataset.tasks.length,
    lists,
    lastSynced: dataset.lastSynced,
  });
}
