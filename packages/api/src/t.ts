import { initTRPC } from '@trpc/server';

export interface Context {
  db: D1Database;
}

/**
 * Initialization of tRPC backend
 */
const t = initTRPC.context<Context>().create();

/**
 * Export reusable router and procedure helpers
 */
export const router = t.router;
export const publicProcedure = t.procedure;
