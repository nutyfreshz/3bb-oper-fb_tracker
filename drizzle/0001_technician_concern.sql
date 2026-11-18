CREATE TABLE facebook_post_concerns (
  group_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  technician_concern TEXT NOT NULL CHECK (technician_concern IN ('yes', 'review', 'no')),
  source TEXT NOT NULL CHECK (source IN ('model', 'manual')),
  evidence TEXT NOT NULL DEFAULT '',
  analyzed_message TEXT,
  PRIMARY KEY (group_id, post_id)
);
