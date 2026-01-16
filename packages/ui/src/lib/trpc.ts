import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../api/src/router';

/**
 * A set of strongly-typed React hooks for consuming our tRPC API.
 */
export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();
