import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../api/src/router';
import { settings } from './config';

export const apiClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${settings.apiUrl}/trpc`,
      headers() {
        return {
          Authorization: `Bearer ${settings.apiToken}`,
        };
      },
    }),
  ],
});
