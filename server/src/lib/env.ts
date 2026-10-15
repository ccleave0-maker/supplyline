import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be a long random value'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be a 32-byte base64 value'),
  CORS_ORIGINS: z.string().default(''),
  APP_URL: z.string().default('http://localhost:3000'),
  DEV_SHOW_LOGIN_CODE: z.string().default('false'),
  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend', 'sendgrid']).default('console'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM_ADDRESS: z.string().default(''),
  RESEND_API_KEY: z.string().default(''),
  SENDGRID_API_KEY: z.string().default(''),
  EMAIL_FROM_ADDRESS: z.string().default('no-reply@example.com'),
  EMAIL_FROM_NAME: z.string().default('Bowron'),
  STORAGE_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  SUPABASE_URL: z.string().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(''),
  SUPABASE_STORAGE_BUCKET: z.string().default('supplyline'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GEOCODER_CONTACT_EMAIL: z.string().default('you@example.com'),
  /** Time zone for 'today' / 'tomorrow' on the load schedule and delivery reminders */
  SCHEDULE_TIMEZONE: z.string().default('America/Vancouver'),
  /** Day-before delivery reminders: run inside the server every hour (on) or not (off) */
  DELIVERY_REMINDERS: z.enum(['on', 'off']).default('on'),
  /** Optional: lets an outside scheduler call POST /api/v1/cron/reminders */
  CRON_SECRET: z.string().default(''),
  /** The platform owner's Claude key: only used for organizations you've allowed (Platform page), within their cap */
  PLATFORM_ANTHROPIC_API_KEY: z.string().default(''),
  /** Online card payments (off when empty). Price ids are per seat, monthly. */
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_STANDARD: z.string().default(''),
  STRIPE_PRICE_PRO: z.string().default(''),
  /** Web Push (browser / installed web app notifications). Made with: pnpm --filter @supplyline/server push:keys */
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default('mailto:support@example.com'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Server configuration is invalid:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => env().NODE_ENV === 'production';
export const devShowLoginCode = () => !isProduction() && env().DEV_SHOW_LOGIN_CODE === 'true';
