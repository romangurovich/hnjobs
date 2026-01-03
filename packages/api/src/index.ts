import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './router';

const app = new Hono();

// Add a more permissive CORS middleware for development
app.use(
  '/trpc/*',
  cors({
    origin: (origin) => origin, // Reflects the request origin
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
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
