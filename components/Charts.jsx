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

const tooltipStyle = {
  background: "rgba(20,20,20,0.95)",
  border: "none",
  borderRadius: 10,
  color: "#fff",
  fontSize: 12,
};

export function StatusDonut({ completed, open, overdue }) {
  const data = [
    { name: "Completed", value: completed },
    { name: "Open", value: open },
    { name: "Overdue", value: overdue },
  ].filter((d) => d.value > 0);

  return (
    <ChartCard title="Task Status Split" subtitle="Across the current filter">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={60}
            outerRadius={95}
            paddingAngle={3}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={STATUS_COLORS[d.name]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function PerAssigneeBar({ rows }) {
  const data = rows
    .map((r) => ({ name: r.assignee, Completed: r.completed, Pending: r.pending, Overdue: r.overdue }))
    .sort((a, b) => b.Completed + b.Pending - (a.Completed + a.Pending))
    .slice(0, 12);

  return (
    <ChartCard title="Workload by Assignee" subtitle="Completed vs pending vs overdue (top 12)">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
          <XAxis
            dataKey="name"
            angle={-30}
            textAnchor="end"
            height={60}
            tick={{ fontSize: 11, fill: "currentColor" }}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "currentColor" }} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(128,128,128,0.1)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Completed" stackId="a" fill="#22c55e" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Pending" stackId="a" fill="#f59e0b" />
          <Bar dataKey="Overdue" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function PerProjectBar({ rows }) {
  const data = (rows || []).slice(0, 10);

  return (
    <ChartCard title="Tasks by Board / Project" subtitle="Total vs completed (top 10)">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
          <XAxis
            dataKey="name"
            angle={-30}
            textAnchor="end"
            height={60}
            tick={{ fontSize: 11, fill: "currentColor" }}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "currentColor" }} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(128,128,128,0.1)" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Total" fill="#6366f1" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Completed" fill="#22c55e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
