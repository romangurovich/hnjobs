import { z } from 'zod';
import { publicProcedure, router } from './t';
import { nanoid } from 'nanoid';

const jobRouter = router({
  save: publicProcedure
    .input(z.object({
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
    }))
    .mutation(async ({ input, ctx }) => {
      const id = nanoid();
      
      // 1. Insert the job
      await ctx.db.prepare(`
        INSERT INTO jobs (
          id, hn_post_id, job_url, company_name, job_title, salary_min, salary_max, 
          salary_currency, location, remote_status, role_level, management_level, 
          summary, processed_from, raw_content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, input.hn_post_id ?? null, input.job_url ?? null, input.company_name, input.job_title, input.salary_min, input.salary_max,
        input.salary_currency, input.location, input.remote_status, input.role_level, 
        input.management_level, input.summary ?? null, input.processed_from, input.raw_content ?? null
      ).run();

      // 2. Handle technologies (simple implementation)
      for (const tech of input.technologies) {
        // Upsert technology
        await ctx.db.prepare(`
          INSERT OR IGNORE INTO technologies (name) VALUES (?)
        `).bind(tech).run();

        // Get the id
        const techRecord = await ctx.db.prepare(`
          SELECT id FROM technologies WHERE name = ?
        `).bind(tech).first<{ id: number }>();

        if (techRecord) {
          await ctx.db.prepare(`
            INSERT INTO job_technologies (job_id, technology_id) VALUES (?, ?)
          `).bind(id, techRecord.id).run();
        }
      }

      return { id };
    }),

  list: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      roleLevels: z.array(z.string()).optional(),
      remoteStatuses: z.array(z.string()).optional(),
      minSalary: z.number().nullable().optional(),
      technologies: z.array(z.string()).optional(),
      page: z.number().default(1),
      pageSize: z.number().default(10),
      sortBy: z.enum(['created_at', 'salary_max', 'company_name']).default('created_at'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
    }).optional())
    .query(async ({ input, ctx }) => {
      let conditions: string[] = [];
      let params: any[] = [];

      if (input?.search) {
        conditions.push('(j.company_name LIKE ? OR j.job_title LIKE ?)');
        const searchPattern = `%${input.search}%`;
        params.push(searchPattern, searchPattern);
      }

      if (input?.roleLevels && input.roleLevels.length > 0) {
        const placeholders = input.roleLevels.map(() => '?').join(',');
        conditions.push(`j.role_level IN (${placeholders})`);
        params.push(...input.roleLevels);
      }

      if (input?.remoteStatuses && input.remoteStatuses.length > 0) {
        const placeholders = input.remoteStatuses.map(() => '?').join(',');
        conditions.push(`j.remote_status IN (${placeholders})`);
        params.push(...input.remoteStatuses);
      }

      if (input?.minSalary) {
        conditions.push('j.salary_max >= ?');
        params.push(input.minSalary);
      }

      if (input?.technologies && input.technologies.length > 0) {
        const placeholders = input.technologies.map(() => '?').join(',');
        conditions.push(`EXISTS (
          SELECT 1 FROM job_technologies jt2 
          JOIN technologies t2 ON jt2.technology_id = t2.id 
          WHERE jt2.job_id = j.id AND t2.name IN (${placeholders})
        )`);
        params.push(...input.technologies);
      }

      const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

      // 1. Get total count
      const countResult = await ctx.db.prepare(
        `SELECT COUNT(*) as total FROM jobs j${whereClause}`
      ).bind(...params).first<{ total: number }>();
      const total = countResult?.total ?? 0;

      // 2. Get paginated results
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 10;
      const sortBy = input?.sortBy ?? 'created_at';
      const sortOrder = input?.sortOrder ?? 'desc';
      const offset = (page - 1) * pageSize;

      let query = `
        SELECT 
          j.*, 
          GROUP_CONCAT(t.name) as technologies_list
        FROM jobs j
        LEFT JOIN job_technologies jt ON j.id = jt.job_id
        LEFT JOIN technologies t ON jt.technology_id = t.id
        ${whereClause}
        GROUP BY j.id 
        ORDER BY j.${sortBy} ${sortOrder.toUpperCase()}
        LIMIT ? OFFSET ?
      `;

      const { results } = await ctx.db.prepare(query).bind(...params, pageSize, offset).all();
      
      return {
        jobs: results.map((job: any) => ({
          ...job,
          technologies: job.technologies_list ? job.technologies_list.split(',') : [],
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    }),

  getTechnologies: publicProcedure
    .query(async ({ ctx }) => {
      const { results } = await ctx.db.prepare(`
        SELECT t.name, COUNT(jt.job_id) as job_count
        FROM technologies t
        JOIN job_technologies jt ON t.id = jt.technology_id
        GROUP BY t.id
        ORDER BY job_count DESC
        LIMIT 50
      `).all();
      return results;
    }),
});


// The main app router
export const appRouter = router({
  job: jobRouter,
});

// Export the type of the app router for the client
export type AppRouter = typeof appRouter;