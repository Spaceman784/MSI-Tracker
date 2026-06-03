import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// All of one person's ONE-TIME tasks (for the Performance drill-down).
export async function GET(req) {
  const session = cookies().get(SESSION_COOKIE);
  if (!session || !verifySession(session.value)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "NO_SUPABASE" }, { status: 400 });

  const assignee = new URL(req.url).searchParams.get("assignee");
  if (!assignee) return NextResponse.json({ error: "NO_ASSIGNEE" }, { status: 400 });

  const tasks = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from("mis_tasks")
      .select("gid,name,due_on,completed,completed_at,original_due_on,projects,section,sections,one_time_section")
      .eq("assignee", assignee)
      .eq("is_one_time", true)
      .order("due_on", { ascending: true, nullsFirst: false })
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: "DB_ERROR", message: error.message }, { status: 500 });
    tasks.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return NextResponse.json({ assignee, tasks });
}
