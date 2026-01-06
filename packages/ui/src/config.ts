type Env = {
  VITE_TRPC_URL?: string;
};

const env = import.meta.env as Env;

function requireUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing env var ${name}`);
  try {
    new URL(value);
    return value;
  } catch (_err) {
    throw new Error(`Invalid URL in env var ${name}: ${value}`);
  }
}

export const settings = {
  trpcUrl: requireUrl(env.VITE_TRPC_URL, 'VITE_TRPC_URL'),
};

