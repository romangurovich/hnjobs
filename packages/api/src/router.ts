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
      is_manager: z.boolean(),
      technologies: z.array(z.string()),
      summary: z.string().optional(),
      hn_post_id: z.string().nullable().optional(),
      processed_from: z.enum(['LINK', 'POST_CONTENT']),
      raw_content: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = nanoid();
      
      // 1. Insert the job
      await ctx.db.prepare(`
        INSERT INTO jobs (
          id, hn_post_id, company_name, job_title, salary_min, salary_max, 
          salary_currency, location, remote_status, role_level, is_manager, 
          summary, processed_from, raw_content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, input.hn_post_id ?? null, input.company_name, input.job_title, input.salary_min, input.salary_max,
        input.salary_currency, input.location, input.remote_status, input.role_level, 
        input.is_manager ? 1 : 0, input.summary ?? null, input.processed_from, input.raw_content ?? null
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
    }).optional())
    .query(async ({ input, ctx }) => {
      let query = 'SELECT * FROM jobs';
      let conditions: string[] = [];
      let params: any[] = [];

      if (input?.search) {
        conditions.push('(company_name LIKE ? OR job_title LIKE ?)');
        const searchPattern = `%${input.search}%`;
        params.push(searchPattern, searchPattern);
      }

      if (input?.roleLevels && input.roleLevels.length > 0) {
        const placeholders = input.roleLevels.map(() => '?').join(',');
        conditions.push(`role_level IN (${placeholders})`);
        params.push(...input.roleLevels);
      }

      if (input?.remoteStatuses && input.remoteStatuses.length > 0) {
        const placeholders = input.remoteStatuses.map(() => '?').join(',');
        conditions.push(`remote_status IN (${placeholders})`);
        params.push(...input.remoteStatuses);
      }

      if (input?.minSalary) {
        conditions.push('salary_max >= ?');
        params.push(input.minSalary);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      query += ' ORDER BY created_at DESC';

      const { results } = await ctx.db.prepare(query).bind(...params).all();
      
      return results;
    }),
});


// The main app router
export const appRouter = router({
  job: jobRouter,
});

// Export the type of the app router for the client
export type AppRouter = typeof appRouter;
