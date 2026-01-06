import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@hnjobs/api/src/router';
import { settings } from './config';

export const apiClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: settings.trpcUrl,
    }),
  ],
});
