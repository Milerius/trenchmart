-- Which engine produced each automated review: the rules engine alone, or rules plus a model.
-- A third party reading the scan report can then tell a rules verdict from a model verdict.
alter table ai_reviews add column if not exists engine text not null default 'rules@1.0.0';
alter table ai_reviews add column if not exists model text;
