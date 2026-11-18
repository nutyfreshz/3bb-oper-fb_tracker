CREATE TABLE IF NOT EXISTS facebook_posts (
  group_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  message TEXT NOT NULL,
  fix_status TEXT NOT NULL DEFAULT 'pending' CHECK (fix_status IN ('pending', 'fixed')),
  status_updated_at BIGINT,
  PRIMARY KEY (group_id, post_id)
);
CREATE INDEX IF NOT EXISTS facebook_posts_created ON facebook_posts (created_at DESC, post_id DESC);

CREATE TABLE IF NOT EXISTS facebook_post_concerns (
  group_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  technician_concern TEXT NOT NULL CHECK (technician_concern IN ('yes', 'review', 'no')),
  source TEXT NOT NULL CHECK (source IN ('model', 'manual')),
  evidence TEXT NOT NULL DEFAULT '',
  analyzed_message TEXT,
  PRIMARY KEY (group_id, post_id)
);

CREATE TABLE IF NOT EXISTS facebook_post_topics (
  group_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  topic TEXT NOT NULL CHECK (topic IN ('appointment_install', 'repair_quality', 'service_fault', 'billing_plan', 'general', 'unclear')),
  source TEXT NOT NULL CHECK (source IN ('model', 'manual')),
  evidence TEXT NOT NULL DEFAULT '',
  analyzed_message TEXT,
  PRIMARY KEY (group_id, post_id)
);

CREATE TABLE IF NOT EXISTS facebook_post_followups (
  group_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('yes', 'no', 'review')),
  source TEXT NOT NULL CHECK (source IN ('model', 'manual')),
  reason TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  analyzed_message TEXT,
  PRIMARY KEY (group_id, post_id)
);
