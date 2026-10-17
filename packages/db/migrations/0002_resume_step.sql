alter table versions add column if not exists resume_step text;

alter table versions drop constraint if exists versions_resume_step_check;

alter table versions add constraint versions_resume_step_check
  check (resume_step is null or resume_step in ('static', 'sandbox', 'ai'));
