import { z } from 'zod';

const envSchema = z.object({
  ADMIN_UI_ORIGIN: z.string().url(),
  API_BASE_URL: z.string().url(),
  PORT: z.coerce.number().default(8081),
});

const parsed = envSchema.parse(process.env);

export const settings = {
  adminUiOrigin: parsed.ADMIN_UI_ORIGIN,
  apiBaseUrl: parsed.API_BASE_URL,
  port: parsed.PORT,
};

