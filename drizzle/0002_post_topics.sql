CREATE TABLE facebook_post_topics (
  group_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  topic TEXT NOT NULL CHECK (topic IN ('appointment_install', 'repair_quality', 'service_fault', 'billing_plan', 'general', 'unclear')),
  source TEXT NOT NULL CHECK (source IN ('model', 'manual')),
  evidence TEXT NOT NULL DEFAULT '',
  analyzed_message TEXT,
  PRIMARY KEY (group_id, post_id)
);
