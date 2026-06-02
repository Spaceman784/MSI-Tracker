"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusDonut, PerAssigneeBar, PerProjectBar } from "@/components/Charts";

const TABS = ["Overview", "Team", "Tasks", "Charts"];

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [dark, setDark] = useState(false);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("user");
  const [syncing, setSyncing] = useState(false);

  // filters
  const [search, setSearch] = useState("");
  const [fAssignee, setFAssignee] = useState("All");
  const [fProject, setFProject] = useState("All");
  const [fSection, setFSection] = useState("All");
  const [fStatus, setFStatus] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (me) {
          setUsername(me.display_name || me.username);
          setRole(me.role || "user");
        }
      })
      .catch(() => {});
  }, []);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (fAssignee !== "All") p.set("assignee", fAssignee);
    if (fProject !== "All") p.set("project", fProject);
    if (fSection !== "All") p.set("section", fSection);
    if (fStatus !== "All") p.set("status", fStatus);
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    p.set("page", String(page));
    return p.toString();
  }, [search, fAssignee, fProject, fSection, fStatus, dateFrom, dateTo, page]);

  // debounced fetch on any filter change
  const debounceRef = useRef(null);
  useEffect(() => {
    setLoading(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetch(`/api/data?${query}`)
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) {
            setErr(j);
            setData(null);
          } else {
            setErr(null);
            setData(j);
          }
        })
        .catch((e) => setErr({ message: String(e) }))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // reset to page 1 whenever a non-page filter changes
  useEffect(() => {
    setPage(1);
  }, [search, fAssignee, fProject, fSection, fStatus, dateFrom, dateTo]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("mis-theme", next ? "dark" : "light");
    } catch {}
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const j = await res.json();
      alert(j.message || j.error || "Done");
    } finally {
      setSyncing(false);
    }
  }

  function resetFilters() {
    setSearch("");
    setFAssignee("All");
    setFProject("All");
    setFSection("All");
    setFStatus("All");
    setDateFrom("");
    setDateTo("");
  }

  const lists = data?.lists || { assignees: ["All"], projects: ["All"], sections: ["All"] };
  const kpis = data?.kpis || { total: 0, completed: 0, open: 0, overdue: 0 };
  const perAssignee = data?.perAssignee || [];
  const perProject = data?.perProject || [];
  const tasks = data?.tasks || [];
  const total = data?.total || 0;
  const pageSize = data?.pageSize || 200;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="bg-white dark:bg-[#141414] rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center font-bold text-lg shadow">
              N
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">NapChief MIS Performance Dashboard</h1>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {data?.lastSynced
                  ? `Last synced ${new Date(data.lastSynced).toLocaleString()} • ${data.totalTasks?.toLocaleString()} tasks`
                  : "Asana tracking"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {username && (
              <span className="text-xs text-gray-400 dark:text-gray-500 mr-1 hidden sm:inline">{username}</span>
            )}
            <button onClick={toggleTheme} className="btn-ghost" title="Toggle theme">
              {dark ? "☀️ Light" : "🌙 Dark"}
            </button>
            <a href={`/api/data?${query}&format=csv`} className="btn-ghost">
              ⇩ Export CSV
            </a>
            {role === "admin" && (
              <>
                <button onClick={syncNow} disabled={syncing} className="btn-ghost">
                  {syncing ? "Syncing…" : "⟳ Sync now"}
                </button>
                <button onClick={() => router.push("/admin")} className="btn-ghost">
                  ⚙ Users
                </button>
              </>
            )}
            <button onClick={logout} className="btn-primary">
              Logout
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white dark:bg-[#141414] rounded-2xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm mb-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="col-span-2 md:col-span-3 lg:col-span-1">
              <label className="filter-label">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search task, assignee…"
                className="filter-input"
              />
            </div>
            <Select label="Assignee" value={fAssignee} onChange={setFAssignee} options={lists.assignees} />
            <Select label="Board / Project" value={fProject} onChange={setFProject} options={lists.projects} />
            <Select label="Section" value={fSection} onChange={setFSection} options={lists.sections} />
            <Select label="Status" value={fStatus} onChange={setFStatus} options={["All", "Open", "Completed", "Overdue"]} />
            <div className="col-span-2 md:col-span-1">
              <label className="filter-label">Due date (calendar)</label>
              <div className="flex flex-col gap-1.5 min-w-0">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="filter-input min-w-0"
                  title="From date"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="filter-input min-w-0"
                  title="To date"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-between items-center mt-3">
            <span className="text-xs text-gray-400">{loading ? "Loading…" : `${total.toLocaleString()} tasks match`}</span>
            <button onClick={resetFilters} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
              Reset filters
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-full text-sm font-medium border transition ${
                tab === t
                  ? "bg-indigo-600 text-white border-indigo-600 shadow"
                  : "bg-white dark:bg-[#141414] border-gray-200 dark:border-gray-800 hover:border-indigo-400"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Error / empty states */}
        {err && (
          <Panel>
            <p className="font-semibold text-red-600 dark:text-red-400 mb-1">
              {err.error === "NO_SUPABASE" ? "Supabase not connected" : "Could not load data"}
            </p>
            <p className="text-sm text-gray-500">{err.message || "Unknown error"}</p>
          </Panel>
        )}

        {!err && data && data.totalTasks === 0 && (
          <Panel>
            <p className="font-semibold text-amber-600 dark:text-amber-400 mb-1">No data yet</p>
            <p className="text-sm text-gray-500">
              Supabase is connected but empty. Run <code>npm run sync</code> once to pull your Asana workspace (~8 min).
            </p>
          </Panel>
        )}

        {!err && data && data.totalTasks > 0 && (
          <>
            {tab === "Overview" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KPI label="Total Tasks" value={kpis.total} color="text-indigo-600 dark:text-indigo-400" />
                  <KPI label="Completed" value={kpis.completed} color="text-green-600 dark:text-green-400" />
                  <KPI label="Open" value={kpis.open} color="text-amber-600 dark:text-amber-400" />
                  <KPI label="Overdue" value={kpis.overdue} color="text-red-600 dark:text-red-400" />
                </div>
                <AssigneeTable rows={perAssignee} />
              </div>
            )}

            {tab === "Team" && (
              <div className="space-y-4">
                <PerAssigneeBar rows={perAssignee} />
                <AssigneeTable rows={perAssignee} />
              </div>
            )}

            {tab === "Tasks" && (
              <TaskTable
                tasks={tasks}
                today={today}
                page={page}
                pages={pages}
                total={total}
                onPage={setPage}
              />
            )}

            {tab === "Charts" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <StatusDonut completed={kpis.completed} open={kpis.open - kpis.overdue} overdue={kpis.overdue} />
                <PerProjectBar rows={perProject} />
                <div className="lg:col-span-2">
                  <PerAssigneeBar rows={perAssignee} />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <style jsx global>{`
        .btn-ghost {
          font-size: 0.8rem;
          padding: 0.4rem 0.7rem;
          border-radius: 0.6rem;
          border: 1px solid rgba(128, 128, 128, 0.25);
          display: inline-flex;
          align-items: center;
        }
        .btn-ghost:hover {
          border-color: #6366f1;
        }
        .btn-primary {
          font-size: 0.8rem;
          padding: 0.4rem 0.85rem;
          border-radius: 0.6rem;
          background: #6366f1;
          color: white;
        }
        .btn-primary:hover {
          background: #4f46e5;
        }
        .filter-label {
          display: block;
          font-size: 0.7rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #9ca3af;
          margin-bottom: 0.3rem;
        }
        .filter-input {
          width: 100%;
          border-radius: 0.6rem;
          border: 1px solid rgba(128, 128, 128, 0.3);
          background: transparent;
          padding: 0.5rem 0.6rem;
          font-size: 0.85rem;
          outline: none;
        }
        .filter-input:focus {
          box-shadow: 0 0 0 2px #6366f1;
        }
      `}</style>
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="filter-label">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="filter-input">
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function Panel({ children }) {
  return (
    <div className="bg-white dark:bg-[#141414] rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
      {children}
    </div>
  );
}

function KPI({ label, value, color }) {
  return (
    <div className="bg-white dark:bg-[#141414] rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
      <p className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function pctBadge(pct) {
  if (pct >= 75) return "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400";
  if (pct >= 40) return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400";
  return "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400";
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function AssigneeTable({ rows }) {
  return (
    <Panel>
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-[#141414]">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800">
              <th className="py-2.5 px-2">Assignee</th>
              <th className="py-2.5 px-2">Total</th>
              <th className="py-2.5 px-2">Completed</th>
              <th className="py-2.5 px-2">Pending</th>
              <th className="py-2.5 px-2">Overdue</th>
              <th className="py-2.5 px-2">Completion</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-gray-400">
                  No data for the current filters.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.assignee} className="border-b border-gray-100 dark:border-gray-900 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]">
                <td className="py-2.5 px-2">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-xs font-semibold">
                      {initials(r.assignee)}
                    </span>
                    <span className="font-medium">{r.assignee}</span>
                  </div>
                </td>
                <td className="py-2.5 px-2">{r.total}</td>
                <td className="py-2.5 px-2 text-green-600 dark:text-green-400">{r.completed}</td>
                <td className="py-2.5 px-2 text-amber-600 dark:text-amber-400">{r.pending}</td>
                <td className="py-2.5 px-2 text-red-600 dark:text-red-400">{r.overdue}</td>
                <td className="py-2.5 px-2">
                  <span className={`inline-block px-2 py-1 rounded-md text-xs font-semibold ${pctBadge(r.pct)}`}>
                    {r.pct}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TaskTable({ tasks, today, page, pages, total, onPage }) {
  return (
    <Panel>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400">{total.toLocaleString()} tasks</p>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="btn-ghost">
            ‹ Prev
          </button>
          <span className="text-xs text-gray-500">
            Page {page} / {pages}
          </span>
          <button onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages} className="btn-ghost">
            Next ›
          </button>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-[#141414]">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-800">
              <th className="py-2.5 px-2">Task</th>
              <th className="py-2.5 px-2">Assignee</th>
              <th className="py-2.5 px-2">Project</th>
              <th className="py-2.5 px-2">Section</th>
              <th className="py-2.5 px-2">Due</th>
              <th className="py-2.5 px-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-gray-400">
                  No tasks match the current filters.
                </td>
              </tr>
            )}
            {tasks.map((t) => {
              const overdue = !t.completed && t.due_on && t.due_on < today;
              const status = t.completed ? "Completed" : overdue ? "Overdue" : "Open";
              const cls = t.completed
                ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                : overdue
                ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400";
              return (
                <tr key={t.gid} className="border-b border-gray-100 dark:border-gray-900 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]">
                  <td className="py-2.5 px-2 max-w-xs truncate" title={t.name}>{t.name}</td>
                  <td className="py-2.5 px-2">{t.assignee}</td>
                  <td className="py-2.5 px-2 text-gray-500">
                    {(() => {
                      const ps = t.projects && t.projects.length ? t.projects : t.project ? [t.project] : [];
                      const title = ps.join(", ");
                      return (
                        <span title={title}>
                          {ps[0] || "—"}
                          {ps.length > 1 && (
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 text-[10px] font-semibold">
                              +{ps.length - 1}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-2.5 px-2 text-gray-500">
                    {(t.sections && t.sections.length ? t.sections : t.section ? [t.section] : []).join(", ") || "—"}
                  </td>
                  <td className="py-2.5 px-2 text-gray-500">{t.due_on || "—"}</td>
                  <td className="py-2.5 px-2">
                    <span className={`inline-block px-2 py-1 rounded-md text-xs font-semibold ${cls}`}>{status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
