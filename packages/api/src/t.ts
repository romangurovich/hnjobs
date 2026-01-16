/// <reference types="@cloudflare/workers-types" />
import { initTRPC, TRPCError } from '@trpc/server';

export interface Context {
  db: D1Database;
  apiToken: string;
  authToken: string | null; // Token from Authorization header
}

/**
 * Initialization of tRPC backend
 */
const t = initTRPC.context<Context>().create();

/**
 * Middleware to check for valid API token
 */
const isAuthorized = t.middleware(({ ctx, next }) => {
  if (!ctx.authToken) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Missing Authorization header',
    });
  }

  if (ctx.authToken !== ctx.apiToken) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Invalid API token',
    });
  }

  return next();
});

/**
 * Export reusable router and procedure helpers
 */
export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(isAuthorized);
