CREATE TABLE linear.task_correlations (
  external_type TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (external_type, external_ref)
);
