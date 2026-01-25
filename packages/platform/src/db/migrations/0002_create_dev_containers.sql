-- Dev Containers Table
-- Tracks container state for dev-agent workflow
-- Database-first approach for lifecycle management

CREATE TABLE IF NOT EXISTS platform.dev_containers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'stopped', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One container per task
CREATE UNIQUE INDEX IF NOT EXISTS dev_containers_task_id_unique
  ON platform.dev_containers(task_id);

-- Index for cleanup queries (find inactive containers)
CREATE INDEX IF NOT EXISTS dev_containers_last_activity_idx
  ON platform.dev_containers(last_activity);

-- Index for status queries
CREATE INDEX IF NOT EXISTS dev_containers_status_idx
  ON platform.dev_containers(status);

COMMENT ON TABLE platform.dev_containers IS 'Tracks dev container state for lifecycle management';
COMMENT ON COLUMN platform.dev_containers.task_id IS 'Linear issue ID or task identifier';
COMMENT ON COLUMN platform.dev_containers.container_id IS 'Docker container ID (full 64 char)';
COMMENT ON COLUMN platform.dev_containers.status IS 'Container status: running, stopped, or failed';
COMMENT ON COLUMN platform.dev_containers.last_activity IS 'Updated on each exec command for timeout cleanup';
