import { createTRPCReact, type CreateTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '../../../../api/src/router';

export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();
