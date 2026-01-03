import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@hnjobs/api/src/router';

/**
 * A set of strongly-typed React hooks for consuming our tRPC API.
 */
export const trpc = createTRPCReact<AppRouter>();
