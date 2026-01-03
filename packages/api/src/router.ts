import { z } from 'zod';
import { publicProcedure, router } from './t';
import { getTemporalClient } from './temporal';
import { nanoid } from 'nanoid';

const jobRouter = router({
  create: publicProcedure
    .input(z.object({
      url: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      const temporalClient = getTemporalClient();
      const workflowId = `job-${nanoid()}`;

      await temporalClient.workflow.start('crawlAndProcessJob', {
        taskQueue: 'hn-jobs',
        workflowId: workflowId,
        args: [input.url],
      });

      return { workflowId };
    }),

  list: publicProcedure
    .input(z.object({
      search: z.string().optional(),
      // Add other filter inputs here
    }).optional())
    .query(({ input }) => {
      console.log(`Received query with input:`, input);
      // Mock data for now
      const mockJobs = [
        {
          id: '1',
          company_name: 'Stripe',
          job_title: 'Frontend Engineer',
          salary_min: 150000,
          salary_max: 250000,
          salary_currency: 'USD',
          location: 'Remote',
          remote_status: 'REMOTE_ONLY',
          role_level: 'SENIOR',
          is_manager: false,
          technologies: ['React', 'TypeScript', 'GraphQL'],
        },
        {
          id: '2',
          company_name: 'Netflix',
          job_title: 'Backend Engineer (L5)',
          salary_min: 400000,
          salary_max: 600000,
          salary_currency: 'USD',
          location: 'Los Gatos, CA',
          remote_status: 'ON_SITE',
          role_level: 'STAFF',
          is_manager: false,
          technologies: ['Java', 'Spring', 'Microservices'],
        },
      ];

      if (input?.search) {
        return mockJobs.filter(job => 
          job.job_title.toLowerCase().includes(input.search!.toLowerCase()) ||
          job.company_name.toLowerCase().includes(input.search!.toLowerCase())
        );
      }

      return mockJobs;
    }),
});


// The main app router
export const appRouter = router({
  job: jobRouter,
});

// Export the type of the app router for the client
export type AppRouter = typeof appRouter;
