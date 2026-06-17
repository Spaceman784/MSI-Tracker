import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Planned vs Actual: one-time tasks PLANNED (due) in a range vs DONE ON TIME.
// No from/to params = all time.
//
// fixed=1 (with a `to` date) => "Fixed" mode: read the FROZEN snapshot at the END
// of the range, so a past-week review never changes when tasks are rescheduled.
// If no snapshot exists for that range yet (table just created / reviewing a week
// before snapshots began), fall back to live and tell the UI (snapshot_used=false).
export async function GET(req) {
  const session = cookies().get(SESSION_COOKIE);
  if (!session || !verifySession(session.value)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "NO_SUPABASE" }, { status: 400 });

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") || null;
  const to = sp.get("to") || null;
  const fixed = sp.get("fixed") === "1";
  const asOf = fixed ? to : null; // freeze as of the END of the range
  const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

  // In Fixed mode, find the latest snapshot on/before the end date.
  let snapDate = null;
  if (asOf) {
    const { data: snap } = await sb
      .from("mis_due_snapshots")
      .select("snap_date")
      .lte("snap_date", asOf)
      .order("snap_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (snap) snapDate = snap.snap_date;
  }

  // Only Fixed-with-snapshot passes p_as_of; everything else stays on live data
  // (this also keeps Dynamic working if the new 3-arg SQL hasn't been run yet).
  const params = { p_from: from, p_to: to };
  if (snapDate) params.p_as_of = snapDate;

  const { data, error } = await sb.rpc("mis_planned_actual", params);
  if (error) {
    const missing = /mis_planned_actual/.test(error.message);
    return NextResponse.json(
      {
        error: missing ? "NO_FUNCTION" : "DB_ERROR",
        message: missing
          ? "Planned-vs-Actual function not installed. Run the SQL in Supabase, then reload."
          : error.message,
      },
      { status: missing ? 400 : 500 }
    );
  }
  // Coverage / freshness flags, so the UI never sells a stale substitute as a
  // faithful freeze:
  //  - in_progress: the range ends today or later, so it can't be frozen yet
  //    (the end-of-range snapshot is still being overwritten by each sync).
  //  - stale: the range has fully ended but its end-date snapshot is MISSING
  //    (a sync gap), so we're showing the nearest EARLIER snapshot instead.
  const inProgress = Boolean(asOf) && asOf >= todayIST;
  const stale = Boolean(snapDate) && !inProgress && Boolean(asOf) && snapDate < asOf;

  return NextResponse.json({
    rows: data || [],
    fixed,
    snapshot_used: Boolean(snapDate),
    as_of: snapDate || asOf || null,
    stale,
    in_progress: inProgress,
  });
}
