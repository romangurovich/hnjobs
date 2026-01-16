import { z } from 'zod';

const envSchema = z.object({
  ADMIN_UI_ORIGIN: z.string().url(),
  API_URL: z.string().url(),
  PORT: z.coerce.number().default(8081),
});

const parsed = envSchema.parse(process.env);

export const settings = {
  adminUiOrigin: parsed.ADMIN_UI_ORIGIN,
  apiUrl: parsed.API_URL,
  port: parsed.PORT,
};

