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
    'perAssignee', (
      select coalesce(jsonb_agg(r), '[]'::jsonb) from (
        select jsonb_build_object(
          'assignee',     assignee,
          'total',        count(*),                                              -- all boards
          'completed',    count(*) filter (where completed),                     -- all boards
          'pending',      count(*) filter (where not completed),                 -- all boards
          'overdue',      count(*) filter (where not completed and due_on < current_date),
          'ot_total',     count(*) filter (where is_one_time),                   -- one-time only
          'ot_completed', count(*) filter (where is_one_time and completed),     -- one-time only
          -- Completion % = ONE-TIME completed / ONE-TIME total
          'pct',          coalesce(round(100.0 * count(*) filter (where is_one_time and completed)
                                   / nullif(count(*) filter (where is_one_time), 0)), 0)
        ) r
        from f group by assignee order by count(*) desc
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
