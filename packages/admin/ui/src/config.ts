type Env = {
  VITE_ADMIN_API_URL?: string;
  VITE_API_URL?: string;
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
  adminApiUrl: requireUrl(env.VITE_ADMIN_API_URL, 'VITE_ADMIN_API_URL'),
  trpcUrl: requireUrl(env.VITE_API_URL, 'VITE_API_URL'),
};

