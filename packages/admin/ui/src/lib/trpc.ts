import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@hnjobs/api/src/router';

export const trpc = createTRPCReact<AppRouter>();
