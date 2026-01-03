import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../api/src/router'; // This path is a placeholder

/**
 * A set of strongly-typed React hooks for consuming our tRPC API.
 */
export const trpc = createTRPCReact<AppRouter>();
