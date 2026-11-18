CREATE TABLE facebook_post_followups (
  group_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('yes', 'no', 'review')),
  source TEXT NOT NULL CHECK (source IN ('model', 'manual')),
  reason TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '',
  analyzed_message TEXT,
  PRIMARY KEY (group_id, post_id)
);
