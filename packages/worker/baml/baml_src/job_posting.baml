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
  management_level int
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

    For 'management_level', provide an integer from 0 to 10:
    - 0: Pure Individual Contributor (no management responsibilities).
    - 5: Lead / Staff role with significant mentoring or partial management.
    - 10: Pure Management (Director, CTO, etc.).

    {{ raw_text }}

    {{ ctx.output_format }}
  "#
}

function ExtractURLs(text: string) -> string[] {
  client OpenRouter
  prompt #"
    Analyze the following text and extract ALL URLs that point directly to a specific job description or an application page on an Applicant Tracking System (ATS) like Greenhouse, Lever, Ashby, Workable, etc.

    IMPORTANT: 
    - Exclude generic company homepages (e.g., 'https://google.com').
    - Exclude links to general 'Careers' pages if a direct link to a specific role is present.
    - Exclude links to social media or irrelevant sites.
    - If the text mentions multiple different roles with different links, include ALL of them.

    {{ text }}

    {{ ctx.output_format }}
  "#
}
