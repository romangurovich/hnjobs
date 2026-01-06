import { z } from 'zod';

export const jobInputSchema = z.object({
  company_name: z.string(),
  job_title: z.string(),
  salary_min: z.number().nullable(),
  salary_max: z.number().nullable(),
  salary_currency: z.string().nullable(),
  location: z.string(),
  remote_status: z.string(),
  role_level: z.string(),
  management_level: z.number().min(0).max(10),
  technologies: z.array(z.string()),
  summary: z.string().optional(),
  hn_post_id: z.string().nullable().optional(),
  job_url: z.string().nullable().optional(),
  processed_from: z.enum(['LINK', 'POST_CONTENT']),
  raw_content: z.string().optional(),
});

export type JobInput = z.infer<typeof jobInputSchema>;
