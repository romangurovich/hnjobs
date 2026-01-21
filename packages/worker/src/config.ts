function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function requireUrl(name: string): string {
  const value = requireEnv(name);
  try {
    new URL(value);
    return value;
  } catch {
    throw new Error(`Invalid URL in env var ${name}: ${value}`);
  }
}

export const settings = {
  apiUrl: requireUrl('API_URL'),
  apiToken: requireEnv('API_TOKEN'),
  // Temporal configuration
  temporalAddress: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  temporalNamespace: process.env.TEMPORAL_NAMESPACE || 'default',
};

