enum RemoteStatus {
  REMOTE_ONLY
  HYBRID
  ON_SITE
}

enum RoleLevel {
  JUNIOR
  MID
  SENIOR
  STAFF
}

class JobPosting {
  company_name string
  job_title string
  salary_min int?
  salary_max int?
  salary_currency string?
  location string
  remote_status RemoteStatus
  role_level RoleLevel
  is_manager bool
  technologies string[]
}

function ExtractJobPosting(raw_text: string) -> JobPosting {
  client OpenRouter
  prompt #"
    Extract the job posting information from the following text:
    {{ raw_text }}

    {{ ctx.output_format }}
  "#
}
