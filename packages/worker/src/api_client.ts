import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@hnjobs/api/src/router';

export const apiClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:8787/trpc', // URL of our API Cloudflare Worker
    }),
  ],
});
