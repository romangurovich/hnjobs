import { z } from 'zod';

const envSchema = z.object({
  ADMIN_UI_ORIGIN: z.string().url(),
  API_URL: z.string().url(),
  PORT: z.coerce.number().default(8081),
  
  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  
  // JWT secret for session tokens
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  
  // Comma-separated list of allowed email addresses or domains
  // e.g., "user@example.com,@company.com" (prefix with @ for domain matching)
  ALLOWED_EMAILS: z.string().min(1),
});

const parsed = envSchema.parse(process.env);

// Parse allowed emails into a list
const allowedEmails = parsed.ALLOWED_EMAILS
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const settings = {
  adminUiOrigin: parsed.ADMIN_UI_ORIGIN,
  apiUrl: parsed.API_URL,
  port: parsed.PORT,
  googleClientId: parsed.GOOGLE_CLIENT_ID,
  googleClientSecret: parsed.GOOGLE_CLIENT_SECRET,
  jwtSecret: parsed.JWT_SECRET,
  allowedEmails,
};

/**
 * Check if an email is allowed to access the admin UI
 */
export function isEmailAllowed(email: string): boolean {
  const normalizedEmail = email.toLowerCase();
  return allowedEmails.some((allowed) => {
    if (allowed.startsWith('@')) {
      // Domain matching
      return normalizedEmail.endsWith(allowed);
    }
    // Exact email matching
    return normalizedEmail === allowed;
  });
}

