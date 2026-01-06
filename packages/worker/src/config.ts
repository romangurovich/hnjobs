function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  try {
    new URL(value);
    return value;
  } catch (_err) {
    throw new Error(`Invalid URL in env var ${name}: ${value}`);
  }
}

export const settings = {
  trpcUrl: requireEnv('TRPC_URL'),
};

