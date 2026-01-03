import { Hono } from 'hono';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './router';

const app = new Hono();

// Setup the tRPC server
app.use(
  '/trpc/*',
  trpcServer({
    router: appRouter,
  })
);

app.get('/', (c) => {
  return c.text('tRPC server is running');
});

export default app;
