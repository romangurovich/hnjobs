import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './router';

const app = new Hono();

// Add CORS middleware
app.use(
  '/trpc/*',
  cors({
    origin: 'http://localhost:5173', // Allow the UI dev server
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  })
);

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
