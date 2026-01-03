import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './router';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

// Add CORS middleware
app.use(
  '/trpc/*',
  cors({
    origin: (origin) => {
      const allowedOrigins = ['http://localhost:5174', 'http://localhost:5175'];
      return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    },
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
    createContext: (opts, c) => {
      if (!c.env.DB) {
        console.error('D1 Database binding "DB" is missing!');
      }
      return {
        db: c.env.DB,
      };
    },
  })
);

app.get('/', (c) => {
  return c.text('tRPC server is running');
});

export default app;
