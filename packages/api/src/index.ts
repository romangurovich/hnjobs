import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { appRouter } from './router';
import { parseOrigins } from './config';

type Bindings = {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  API_TOKEN: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Add CORS middleware
app.use(
  '/trpc/*',
  cors({
    origin: (origin, c) => {
      const allowedOrigins = parseOrigins(c.env.ALLOWED_ORIGINS);
      return origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    },
    allowHeaders: ['Content-Type', 'Authorization'],
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

      // Extract bearer token from Authorization header
      const authHeader = opts.req.headers.get('authorization');
      let authToken: string | null = null;
      if (authHeader?.startsWith('Bearer ')) {
        authToken = authHeader.slice(7);
      }

      return {
        db: c.env.DB,
        apiToken: c.env.API_TOKEN,
        authToken,
      };
    },
  })
);

app.get('/', (c) => {
  return c.text('tRPC server is running');
});

export default app;
