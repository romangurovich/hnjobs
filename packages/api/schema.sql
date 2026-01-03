DROP TABLE IF EXISTS job_technologies;
DROP TABLE IF EXISTS technologies;
DROP TABLE IF EXISTS jobs;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  hn_post_id TEXT, -- The ID of the HN comment
  company_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  salary_min INTEGER,
  salary_max INTEGER,
  salary_currency TEXT,
  location TEXT NOT NULL,
  remote_status TEXT NOT NULL, -- REMOTE_ONLY, HYBRID, ON_SITE
  role_level TEXT NOT NULL,    -- JUNIOR, MID, SENIOR, STAFF
  management_level INTEGER NOT NULL, -- 0-10 scale
  summary TEXT,
  processed_from TEXT NOT NULL, -- 'LINK' or 'POST_CONTENT'
  raw_content TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE technologies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE job_technologies (
  job_id TEXT NOT NULL,
  technology_id INTEGER NOT NULL,
  PRIMARY KEY (job_id, technology_id),
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (technology_id) REFERENCES technologies(id) ON DELETE CASCADE
);
