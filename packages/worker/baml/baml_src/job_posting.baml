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
  summary string
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
    Extract the job posting information from the following text. 
    
    Provide a comprehensive paragraph-length summary in the 'summary' field.
    The summary should:
    - Clearly explain what the company does and its mission.
    - Detail the specific responsibilities and impact the applicant will have.
    - Highlight what makes this specific opportunity unique or compelling for a technical candidate.

    {{ raw_text }}

    {{ ctx.output_format }}
  "#
}

function ExtractURLs(text: string) -> string[] {
  client OpenRouter
  prompt #"
    Find all URLs in the following text that likely point to a job description page or company careers site.
    Exclude links to Hacker News itself or other irrelevant sites.

    {{ text }}

    {{ ctx.output_format }}
  "#
}
