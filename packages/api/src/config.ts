function parseOrigins(raw: string | undefined): string[] {
  if (!raw) {
    throw new Error('Missing env var ALLOWED_ORIGINS (comma-separated URLs)');
  }
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error('ALLOWED_ORIGINS must contain at least one URL');
  }
  origins.forEach((o) => {
    try {
      new URL(o);
    } catch (_err) {
      throw new Error(`Invalid URL in ALLOWED_ORIGINS: ${o}`);
    }
  });
  return origins;
}

export const settings = {
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
};

