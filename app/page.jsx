"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusDonut, PerAssigneeBar, PerProjectBar } from "@/components/Charts";

const TABS = ["Overview", "Team", "Tasks", "Charts"];

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

export default function Dashboard() {
  const router = useRouter();
  const [raw, setRaw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [dark, setDark] = useState(false);
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("user");

  // filters
  const [search, setSearch] = useState("");
  const [fAssignee, setFAssignee] = useState("All");
  const [fProject, setFProject] = useState("All");
  const [fSection, setFSection] = useState("All");
  const [fStatus, setFStatus] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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
    load(false);
  }, []);

  async function load(force) {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/asana${force ? "?refresh=1" : ""}`);
      const data = await res.json();
      if (!res.ok) {
        setErr(data);
        setRaw(null);
      } else {
        setRaw(data);
      }
    } catch (e) {
      setErr({ message: String(e) });
    } finally {
      setLoading(false);
    }
  }

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

  const tasks = raw?.tasks || [];
  const today = todayStr();

  const assignees = useMemo(() => {
    const set = new Set(tasks.map((t) => t.assignee));
    (raw?.members || []).forEach((m) => set.add(m));
    return ["All", ...Array.from(set).sort()];
  }, [tasks, raw]);
  const projects = useMemo(
    () => ["All", ...Array.from(new Set(tasks.map((t) => t.project))).sort()],
    [tasks]
  );
  const sections = useMemo(
    () => ["All", ...Array.from(new Set(tasks.map((t) => t.section))).sort()],
    [tasks]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (fAssignee !== "All" && t.assignee !== fAssignee) return false;
      if (fProject !== "All" && t.project !== fProject) return false;
      if (fSection !== "All" && t.section !== fSection) return false;
      const overdue = !t.completed && t.due_on && t.due_on < today;
      if (fStatus === "Completed" && !t.completed) return false;
      if (fStatus === "Open" && t.completed) return false;
      if (fStatus === "Overdue" && !overdue) return false;
      if (dateFrom || dateTo) {
        if (!t.due_on) return false;
        if (dateFrom && t.due_on < dateFrom) return false;
        if (dateTo && t.due_on > dateTo) return false;
      }
      if (q) {
        const hay = `${t.name} ${t.assignee} ${t.project} ${t.section}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, search, fAssignee, fProject, fSection, fStatus, dateFrom, dateTo, today]);

  const kpis = useMemo(() => {
    let completed = 0,
      open = 0,
      overdue = 0;
    for (const t of filtered) {
      if (t.completed) completed++;
      else {
        open++;
        if (t.due_on && t.due_on < today) overdue++;
      }
    }
    return { total: filtered.length, completed, open, overdue };
  }, [filtered, today]);

  const perAssignee = useMemo(() => {
    const map = {};
    for (const t of filtered) {
      if (!map[t.assignee])
        map[t.assignee] = { assignee: t.assignee, total: 0, completed: 0, pending: 0, overdue: 0 };
      const row = map[t.assignee];
      row.total++;
      if (t.completed) row.completed++;
      else {
        row.pending++;
        if (t.due_on && t.due_on < today) row.overdue++;
      }
    }
    return Object.values(map)
      .map((r) => ({ ...r, pct: r.total ? Math.round((r.completed / r.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [filtered, today]);

  function resetFilters() {
    setSearch("");
    setFAssignee("All");
    setFProject("All");
    setFSection("All");
    setFStatus("All");
    setDateFrom("");
    setDateTo("");
  }

  function exportCSV() {
    const headers = ["Task", "Assignee", "Project", "Section", "Status", "Due", "Completed At"];
    const lines = [headers.join(",")];
    for (const t of filtered) {
      const overdue = !t.completed && t.due_on && t.due_on < today;
      const status = t.completed ? "Completed" : overdue ? "Overdue" : "Open";
      const row = [t.name, t.assignee, t.project, t.section, status, t.due_on || "", t.completed_at || ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
      lines.push(row);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "napchief-mis-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

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
                {raw?.workspace ? `${raw.workspace} • ` : ""}
                {raw?.fetchedAt ? `Updated ${new Date(raw.fetchedAt).toLocaleString()}` : "Asana tracking"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {username && (
              <span className="text-xs text-gray-400 dark:text-gray-500 mr-1 hidden sm:inline">
                {username}
              </span>
            )}
            <button onClick={toggleTheme} className="btn-ghost" title="Toggle theme">
              {dark ? "☀️ Light" : "🌙 Dark"}
            </button>
            <button onClick={() => load(true)} className="btn-ghost">
              ↻ Refresh
            </button>
            <button onClick={exportCSV} className="btn-ghost">
              ⇩ Export CSV
            </button>
            {role === "admin" && (
              <button onClick={() => router.push("/admin")} className="btn-ghost">
                ⚙ Users
              </button>
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
            <Select label="Assignee" value={fAssignee} onChange={setFAssignee} options={assignees} />
            <Select label="Board / Project" value={fProject} onChange={setFProject} options={projects} />
            <Select label="Section" value={fSection} onChange={setFSection} options={sections} />
            <Select
              label="Status"
              value={fStatus}
              onChange={setFStatus}
              options={["All", "Open", "Completed", "Overdue"]}
            />
            <div className="col-span-2 md:col-span-1">
              <label className="filter-label">Due date (calendar)</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="filter-input"
                  title="From date"
                />
                <span className="text-xs text-gray-400">→</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="filter-input"
                  title="To date"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-3">
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

        {/* States */}
        {loading && <Panel><p className="text-sm text-gray-500">Loading workspace from Asana…</p></Panel>}

        {!loading && err && (
          <Panel>
            <p className="font-semibold text-red-600 dark:text-red-400 mb-1">
              {err.error === "NO_TOKEN" ? "Asana token not set" : "Could not load Asana data"}
            </p>
            <p className="text-sm text-gray-500">{err.message || "Unknown error"}</p>
            {err.error === "NO_TOKEN" && (
              <p className="text-xs text-gray-400 mt-2">
                Edit <code>.env.local</code> → set <code>ASANA_TOKEN</code> → restart <code>npm run dev</code>.
              </p>
            )}
          </Panel>
        )}

        {!loading && !err && raw && (
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

            {tab === "Tasks" && <TaskTable tasks={filtered} today={today} />}

            {tab === "Charts" && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <StatusDonut completed={kpis.completed} open={kpis.open - kpis.overdue} overdue={kpis.overdue} />
                <PerProjectBar tasks={filtered} />
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
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function pctBadge(pct) {
  if (pct >= 75) return "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400";
  if (pct >= 40) return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400";
  return "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400";
}

function initials(name) {
  return name
    .split(" ")
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function AssigneeTable({ rows }) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
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

function TaskTable({ tasks, today }) {
  return (
    <Panel>
      <p className="text-xs text-gray-400 mb-3">{tasks.length} tasks</p>
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
                  <td className="py-2.5 px-2 text-gray-500">{t.project}</td>
                  <td className="py-2.5 px-2 text-gray-500">{t.section}</td>
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
