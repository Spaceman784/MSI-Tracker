-- ============================================================
-- NapChief MIS Dashboard — database functions for FAST queries
-- Run this in Supabase -> SQL Editor -> New query -> Run.
-- Safe to run multiple times (uses CREATE OR REPLACE).
-- No re-sync needed.
-- ============================================================

-- Indexes that make filtering by project/section instant
create index if not exists idx_mis_tasks_projects_gin on mis_tasks using gin (projects);
create index if not exists idx_mis_tasks_sections_gin on mis_tasks using gin (sections);

-- Section from the assignee's OWN board (so a person's sections aren't borrowed
-- from shared boards). Populated by the sync.
alter table mis_tasks add column if not exists own_section text;
create index if not exists idx_mis_tasks_own_section on mis_tasks (own_section);

-- Archived tasks (in an "Archived" section, or on an archived board). Kept in the
-- table but HIDDEN by default everywhere; viewable via the Status = 'Archived' filter.
alter table mis_tasks add column if not exists archived boolean default false;
create index if not exists idx_mis_tasks_archived on mis_tasks (archived);

-- ---- Aggregates: KPIs + per-assignee + per-project (with filters) ----
create or replace function mis_summary(
  p_assignee text default null,
  p_project  text default null,
  p_section  text default null,
  p_status   text default null,
  p_from     date default null,
  p_to       date default null,
  p_search   text default null,
  p_archived boolean default false
) returns jsonb language sql stable as $$
  with base as (
    -- all filters EXCEPT completion-status and archived
    select * from mis_tasks t
    where (p_assignee is null or t.assignee = p_assignee)
      and (p_project  is null or coalesce(t.projects, '[]'::jsonb) ? p_project)
      and (p_section  is null or t.own_section = p_section)
      and (p_from   is null or (t.created_at at time zone 'Asia/Kolkata')::date >= p_from)
      and (p_to     is null or (t.created_at at time zone 'Asia/Kolkata')::date <= p_to)
      and (p_search is null or t.name ilike '%'||p_search||'%' or t.assignee ilike '%'||p_search||'%')
  ),
  f as (
    select * from base t
    where (p_status   is null
           or (p_status = 'Completed' and t.completed)
           or (p_status = 'Open'      and not t.completed)
           or (p_status = 'Overdue'   and not t.completed and t.due_on < current_date))
      and coalesce(t.archived, false) = p_archived
  )
  select jsonb_build_object(
    'kpis', (
      select jsonb_build_object(
        'total',     count(*),
        'completed', count(*) filter (where completed),
        'open',      count(*) filter (where not completed),
        'overdue',   count(*) filter (where not completed and due_on < current_date),
        'archived',  (select count(*) from base where coalesce(archived, false) = true)
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
                  from (select distinct assignee a from mis_tasks where assignee is not null and coalesce(archived,false)=false) x),
    'projects',  (select coalesce(jsonb_agg(p order by p), '[]'::jsonb)
                  from (select distinct jsonb_array_elements_text(coalesce(projects, '[]'::jsonb)) p from mis_tasks where coalesce(archived,false)=false) x),
    'sections',  (select coalesce(jsonb_agg(s order by s), '[]'::jsonb)
                  from (select distinct own_section s from mis_tasks where own_section is not null and coalesce(archived,false)=false) x),
    'taskCount', (select count(*) from mis_tasks where coalesce(archived,false)=false),
    'lastSynced',(select value from mis_meta where key = 'last_synced')
  );
$$;

-- ---- Performance: one-time COMPLETION per person ----
-- Score = (completed ÷ total) − 100  →  0% = ALL done (best), −100% = none done (worst).
-- Gradual (half done ≈ −50%). The delayed/overdue/revised columns stay as info,
-- but no longer affect the score itself.
alter table mis_tasks add column if not exists original_due_on date;
alter table mis_tasks add column if not exists one_time_section text;

-- Optional ADDED/CREATED-date window (p_from / p_to). Both null => counts ALL
-- tasks (identical to before). When set => only tasks ADDED in [p_from, p_to]
-- (created_at, by IST day). The one-time scoring logic is unchanged.
drop function if exists mis_performance();
create or replace function mis_performance(p_from date default null, p_to date default null) returns jsonb language sql stable as $$
  with p as (
    select assignee,
      count(*) filter (where is_one_time) as total,
      count(*) filter (where is_one_time and completed) as completed,
      count(*) filter (where is_one_time and not completed) as pending,
      count(*) filter (where is_one_time and not completed and due_on < current_date) as overdue,
      count(*) filter (where is_one_time and completed and due_on is not null and completed_at is not null and completed_at::date <= due_on) as on_time,
      count(*) filter (where is_one_time and completed and due_on is not null and completed_at is not null and completed_at::date >  due_on) as delayed,
      count(*) filter (where is_one_time and completed and due_on is not null and completed_at is not null and (completed_at::date - due_on) > 7) as late_over_7,
      count(*) filter (where is_one_time and completed and (due_on is null or completed_at is null)) as no_due,
      count(*) filter (where is_one_time and original_due_on is not null and due_on is not null and abs(due_on - original_due_on) > 7) as revised,
      coalesce(sum(current_date - due_on) filter (where is_one_time and not completed and due_on < current_date), 0) as days_overdue,
      coalesce(sum(completed_at::date - due_on) filter (where is_one_time and completed and due_on is not null and completed_at is not null and completed_at::date > due_on), 0) as days_late
    from mis_tasks
    where (p_from is null or (created_at at time zone 'Asia/Kolkata')::date >= p_from)
      and (p_to   is null or (created_at at time zone 'Asia/Kolkata')::date <= p_to)
      and coalesce(archived, false) = false
    group by assignee
    having count(*) filter (where is_one_time) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'assignee', assignee, 'total', total, 'completed', completed, 'pending', pending, 'overdue', overdue,
    'on_time', on_time, 'delayed', delayed, 'no_due', no_due, 'revised', revised,
    'days_overdue', days_overdue, 'days_late', days_late,
    -- >7-days-late completions are excluded from BOTH top & bottom (neutral); still shown in 'delayed'.
    'score', coalesce(round(100.0 * (completed - late_over_7) / nullif(total - late_over_7, 0)), 0) - 100
  ) order by coalesce(round(100.0 * (completed - late_over_7) / nullif(total - late_over_7, 0)), 0) - 100 asc), '[]'::jsonb)
  from p;
$$;

-- ---- Planned vs Actual: one-time tasks planned (due) in a range vs done on time ----
-- p_from/p_to filter by DUE date; both null = all time (every one-time task with a due date).
-- Score = ALL completed (on-time + late) ÷ planned − 100 (late counts at full
-- credit; not-done = 0). The on_time / late split is still returned for display.
create or replace function mis_planned_actual(p_from date default null, p_to date default null)
returns jsonb language sql stable as $$
  with p as (
    select assignee,
      count(*) as planned,
      count(*) filter (where completed and completed_at is not null and completed_at::date <= due_on) as on_time,
      count(*) filter (where completed and completed_at is not null and completed_at::date >  due_on) as late,
      count(*) filter (where completed and completed_at is not null and (completed_at::date - due_on) > 7) as late_over_7,
      count(*) filter (where not completed) as not_done,
      count(*) filter (where original_due_on is not null and due_on is not null and abs(due_on - original_due_on) > 7) as revised
    from mis_tasks
    where is_one_time
      and coalesce(archived, false) = false
      and due_on is not null
      and (p_from is null or due_on >= p_from)
      and (p_to   is null or due_on <= p_to)
    group by assignee
    having count(*) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'assignee', assignee, 'planned', planned, 'on_time', on_time, 'late', late, 'not_done', not_done, 'revised', revised,
    -- >7-days-late completions excluded from BOTH top & bottom (neutral); still shown in 'late'.
    'score', coalesce(round(100.0 * (on_time + late - late_over_7) / nullif(planned - late_over_7, 0)), 0) - 100
  ) order by coalesce(round(100.0 * (on_time + late - late_over_7) / nullif(planned - late_over_7, 0)), 0) - 100 asc), '[]'::jsonb)
  from p;
$$;
