"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const STATUS_COLORS = {
  Completed: "#22c55e",
  Open: "#f59e0b",
  Overdue: "#ef4444",
};

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="bg-white dark:bg-[#141414] rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
      <h3 className="font-semibold text-sm">{title}</h3>
      {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{subtitle}</p>}
      <div className="h-72 w-full mt-2">{children}</div>
    </div>
  );
}

// Theme-aware text + tooltip: white text in dark mode, black in light mode.
function tooltipProps(dark) {
  const fg = dark ? "#f3f4f6" : "#111827";
  return {
    contentStyle: {
      background: dark ? "rgba(20,20,20,0.97)" : "#ffffff",
      border: dark ? "1px solid #2a2a2a" : "1px solid #e5e7eb",
      borderRadius: 10,
      fontSize: 12,
      color: fg,
    },
    itemStyle: { color: fg },
    labelStyle: { color: fg, fontWeight: 600 },
  };
}
function axisTick(dark) {
  return { fontSize: 11, fill: dark ? "#cbd5e1" : "#374151" };
}
function legendStyle(dark) {
  return { fontSize: 12, color: dark ? "#e5e7eb" : "#374151" };
}

export function StatusDonut({ completed, open, overdue, dark }) {
  const data = [
    { name: "Completed", value: completed },
    { name: "Open", value: open },
    { name: "Overdue", value: overdue },
  ].filter((d) => d.value > 0);

  return (
    <ChartCard title="Task Status Split" subtitle="Across the current filter">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3}>
            {data.map((d) => (
              <Cell key={d.name} fill={STATUS_COLORS[d.name]} />
            ))}
          </Pie>
          <Tooltip {...tooltipProps(dark)} />
          <Legend iconType="circle" wrapperStyle={legendStyle(dark)} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function PerAssigneeBar({ rows, dark }) {
  const data = rows
    .map((r) => ({ name: r.assignee, Completed: r.completed, Pending: r.pending, Overdue: r.overdue }))
    .sort((a, b) => b.Completed + b.Pending - (a.Completed + a.Pending))
    .slice(0, 12);

  return (
    <ChartCard title="Workload by Assignee" subtitle="Completed vs pending vs overdue (top 12)">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
          <XAxis dataKey="name" angle={-30} textAnchor="end" height={60} tick={axisTick(dark)} />
          <YAxis allowDecimals={false} tick={axisTick(dark)} />
          <Tooltip {...tooltipProps(dark)} cursor={{ fill: "rgba(128,128,128,0.1)" }} />
          <Legend wrapperStyle={legendStyle(dark)} />
          <Bar dataKey="Completed" stackId="a" fill="#22c55e" />
          <Bar dataKey="Pending" stackId="a" fill="#f59e0b" />
          <Bar dataKey="Overdue" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function PerProjectBar({ rows, dark }) {
  const data = (rows || []).slice(0, 10);

  return (
    <ChartCard title="Tasks by Board / Project" subtitle="Total vs completed (top 10)">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
          <XAxis dataKey="name" angle={-30} textAnchor="end" height={60} tick={axisTick(dark)} />
          <YAxis allowDecimals={false} tick={axisTick(dark)} />
          <Tooltip {...tooltipProps(dark)} cursor={{ fill: "rgba(128,128,128,0.1)" }} />
          <Legend wrapperStyle={legendStyle(dark)} />
          <Bar dataKey="Total" fill="#6366f1" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Completed" fill="#22c55e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
