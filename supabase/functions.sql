-- ============================================================
-- NapChief MIS Dashboard — database functions for FAST queries
-- Run this in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run multiple times (uses CREATE OR REPLACE).
-- No re-sync needed.
-- ============================================================

-- Indexes that make filtering by project/section instant
create index if not exists idx_mis_tasks_projects_gin on mis_tasks using gin (projects);
create index if not exists idx_mis_tasks_sections_gin on mis_tasks using gin (sections);

-- ---- Aggregates: KPIs + per-assignee + per-project (with filters) ----
create or replace function mis_summary(
  p_assignee text default null,
  p_project  text default null,
  p_section  text default null,
  p_status   text default null,
  p_from     date default null,
  p_to       date default null,
  p_search   text default null
) returns jsonb language sql stable as $$
  with f as (
    select * from mis_tasks t
    where (p_assignee is null or t.assignee = p_assignee)
      and (p_project  is null or coalesce(t.projects, '[]'::jsonb) ? p_project)
      and (p_section  is null or coalesce(t.sections, '[]'::jsonb) ? p_section)
      and (p_status   is null
           or (p_status = 'Completed' and t.completed)
           or (p_status = 'Open'      and not t.completed)
           or (p_status = 'Overdue'   and not t.completed and t.due_on < current_date))
      and (p_from   is null or t.due_on >= p_from)
      and (p_to     is null or t.due_on <= p_to)
      and (p_search is null or t.name ilike '%'||p_search||'%' or t.assignee ilike '%'||p_search||'%')
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'total',     count(*),
        'completed', count(*) filter (where completed),
        'open',      count(*) filter (where not completed),
        'overdue',   count(*) filter (where not completed and due_on < current_date)
      ) from f
    ),
    -- Per-person table: ALL columns are ONE-TIME tasks only.
    'perAssignee', (
      select coalesce(jsonb_agg(r), '[]'::jsonb) from (
        select jsonb_build_object(
          'assignee',  assignee,
          'total',     count(*) filter (where is_one_time),
          'completed', count(*) filter (where is_one_time and completed),
          'pending',   count(*) filter (where is_one_time and not completed),
          'overdue',   count(*) filter (where is_one_time and not completed and due_on < current_date),
          'pct',       coalesce(round(100.0 * count(*) filter (where is_one_time and completed)
                               / nullif(count(*) filter (where is_one_time), 0)), 0)
        ) r
        from f
        group by assignee
        having count(*) filter (where is_one_time) > 0   -- only people with one-time tasks
        order by count(*) filter (where is_one_time) desc
      ) s
    ),
    'perProject', (
      select coalesce(jsonb_agg(r), '[]'::jsonb) from (
        select jsonb_build_object('name', proj, 'Total', count(*), 'Completed', count(*) filter (where completed)) r
        from (
          select jsonb_array_elements_text(coalesce(projects, '[]'::jsonb)) proj, completed from f
        ) x
        group by proj order by count(*) desc limit 10
      ) s
    )
  );
$$;

-- ---- Dropdown lists + total count + last-synced ----
create or replace function mis_filter_lists() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'assignees', (select coalesce(jsonb_agg(a order by a), '[]'::jsonb)
                  from (select distinct assignee a from mis_tasks where assignee is not null) x),
    'projects',  (select coalesce(jsonb_agg(p order by p), '[]'::jsonb)
                  from (select distinct jsonb_array_elements_text(coalesce(projects, '[]'::jsonb)) p from mis_tasks) x),
    'sections',  (select coalesce(jsonb_agg(s order by s), '[]'::jsonb)
                  from (select distinct jsonb_array_elements_text(coalesce(sections, '[]'::jsonb)) s from mis_tasks) x),
    'taskCount', (select count(*) from mis_tasks),
    'lastSynced',(select value from mis_meta where key = 'last_synced')
  );
$$;

-- ---- Performance: one-time task timeliness per person (always-negative score) ----
alter table mis_tasks add column if not exists original_due_on date;

create or replace function mis_performance() returns jsonb language sql stable as $$
  with p as (
    select assignee,
      count(*) filter (where is_one_time) as total,
      count(*) filter (where is_one_time and completed) as completed,
      count(*) filter (where is_one_time and not completed) as pending,
      count(*) filter (where is_one_time and not completed and due_on < current_date) as overdue,
      count(*) filter (where is_one_time and completed and due_on is not null and completed_at is not null and completed_at::date <= due_on) as on_time,
      count(*) filter (where is_one_time and completed and due_on is not null and completed_at is not null and completed_at::date >  due_on) as delayed,
      count(*) filter (where is_one_time and completed and (due_on is null or completed_at is null)) as no_due,
      count(*) filter (where is_one_time and original_due_on is not null and due_on is not null and abs(due_on - original_due_on) > 7) as revised,
      coalesce(sum(current_date - due_on) filter (where is_one_time and not completed and due_on < current_date), 0) as days_overdue,
      coalesce(sum(completed_at::date - due_on) filter (where is_one_time and completed and due_on is not null and completed_at is not null and completed_at::date > due_on), 0) as days_late
    from mis_tasks
    group by assignee
    having count(*) filter (where is_one_time) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'assignee', assignee, 'total', total, 'completed', completed, 'pending', pending, 'overdue', overdue,
    'on_time', on_time, 'delayed', delayed, 'no_due', no_due, 'revised', revised,
    'days_overdue', days_overdue, 'days_late', days_late,
    'score', greatest(-100, coalesce(round(-100.0 * (delayed + overdue + revised) / nullif(on_time + delayed + overdue, 0)), 0))
  ) order by greatest(-100, coalesce(round(-100.0 * (delayed + overdue + revised) / nullif(on_time + delayed + overdue, 0)), 0)) asc), '[]'::jsonb)
  from p;
$$;
