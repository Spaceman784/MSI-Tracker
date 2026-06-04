import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// All dates in IST, to match the sync.
function istToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function mondayKeyOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const off = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - off);
  return d.toISOString().slice(0, 10);
}
function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7);
}
function weekLabel(mondayKey) {
  const d = new Date(mondayKey + "T00:00:00Z");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
function monthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTHS[+m - 1]} '${y.slice(2)}`;
}
function lastWeeks(n) {
  const out = [];
  const d = new Date(mondayKeyOf(istToday()) + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const key = d.toISOString().slice(0, 10);
    out.unshift({ key, label: weekLabel(key) });
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return out;
}
function lastMonths(n) {
  const out = [];
  const t = istToday();
  let y = +t.slice(0, 4);
  let m = +t.slice(5, 7);
  for (let i = 0; i < n; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.unshift({ key, label: monthLabel(key) });
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}
function lastDayOfMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of next month
}

// Bucket a task's cycles into the period columns → ['on_time'|'missed'|'none', …].
function bucketCells(kind, cycles, periodKeys) {
  const keyer = kind === "weekly" ? mondayKeyOf : monthKeyOf;
  const sev = (s) => (s === "on_time" ? 0 : 1); // missed/late dominates a period
  const byP = new Map();
  for (const c of cycles || []) {
    if (!c.due) continue;
    const k = keyer(c.due);
    const prev = byP.get(k);
    if (prev === undefined || sev(c.status) > sev(prev)) byP.set(k, c.status);
  }
  return periodKeys.map((k) => (!byP.has(k) ? "none" : byP.get(k) === "on_time" ? "on_time" : "missed"));
}

async function buildKind(sb, kind) {
  const periods = kind === "weekly" ? lastWeeks(6) : lastMonths(6);
  const keys = periods.map((p) => p.key);
  const last = keys[keys.length - 1];
  const from = kind === "weekly" ? keys[0] : `${keys[0]}-01`;
  let to;
  if (kind === "weekly") {
    const d = new Date(last + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 6); // through the current week's Saturday/Sunday
    to = d.toISOString().slice(0, 10);
  } else {
    to = lastDayOfMonth(last);
  }

  const { data, error } = await sb.rpc("mis_recurring_scorecard", { p_kind: kind, p_from: from, p_to: to });
  if (error) return { error };

  const rows = (data || []).map((r) => {
    const cells = bucketCells(kind, r.cycles, keys);
    return {
      person: r.person,
      task: r.task,
      task_gid: r.task_gid,
      board: r.board,
      current_due: r.current_due,
      has_due: r.has_due,
      cells,
      done: cells.filter((c) => c === "on_time").length,
    };
  });
  return { periods: periods.map((p) => p.label), rows };
}

export async function GET() {
  const session = cookies().get(SESSION_COOKIE);
  if (!session || !verifySession(session.value)) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "NO_SUPABASE" }, { status: 400 });

  const weekly = await buildKind(sb, "weekly");
  const monthly = await buildKind(sb, "monthly");

  const err = weekly.error || monthly.error;
  if (err) {
    const missing = /mis_recurring/.test(err.message || "");
    return NextResponse.json(
      {
        error: missing ? "NO_FUNCTION" : "DB_ERROR",
        message: missing
          ? "Weekly/Monthly tracker not installed yet. Run supabase/recurring.sql, then sync."
          : err.message,
      },
      { status: missing ? 400 : 500 }
    );
  }

  const { data: meta } = await sb.from("mis_meta").select("value").eq("key", "recurring_last_synced").maybeSingle();

  return NextResponse.json({ weekly, monthly, lastSynced: (meta && meta.value) || null });
}
