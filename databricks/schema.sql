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
