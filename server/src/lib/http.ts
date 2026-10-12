import { ZodError, type ZodType } from 'zod';
import { authenticate, type AuthContext } from './auth';
import { env } from './env';
import { ApiError, badRequest } from './errors';
import { rateLimit } from './rate-limit';

// Origins used by the packaged apps (Capacitor and Tauri serve the UI locally).
const NATIVE_ORIGINS = [
  'capacitor://localhost',
  'http://localhost',
  'https://localhost',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
];

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const configured = env()
    .CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return configured.includes(origin) || NATIVE_ORIGINS.includes(origin) ? origin : null;
}

function withCors(req: Request, res: Response): Response {
  const origin = allowedOrigin(req.headers.get('origin'));
  if (origin) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.append('Vary', 'Origin');
  }
  res.headers.set('X-API-Version', 'v1');
  // Security headers (the API only returns JSON and files).
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  if (!res.headers.has('Content-Security-Policy')) res.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'no-store');
  if (env().APP_URL.startsWith('https://')) res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return res;
}

function errorResponse(err: unknown, req?: Request): Response {
  if (err instanceof ApiError) {
    return Response.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    const first = err.issues[0]?.message ?? 'Check the highlighted fields.';
    return Response.json({ error: { code: 'validation', message: first, details: { fields } } }, { status: 400 });
  }
  console.error('[api] unhandled error', err);
  // Into the error log (Platform › Errors). Never awaited: the reply goes out regardless.
  void import('../services/errors').then(({ recordError }) =>
    recordError({ source: 'SERVER', message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : null, path: req ? `${req.method} ${new URL(req.url).pathname}` : null, app: 'server' }),
  );
  return Response.json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } }, { status: 500 });
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const PUBLIC_PER_MIN = 30;
const API_PER_MIN = 1200;
const MFA_OPEN = ['/api/v1/me', '/api/v1/auth/mfa/', '/api/v1/auth/logout'];

interface HandlerArgs {
  req: Request;
  url: URL;
  params: Record<string, string>;
}
type AuthedHandler = (args: HandlerArgs & { auth: AuthContext }) => Promise<unknown>;
type PublicHandler = (args: HandlerArgs) => Promise<unknown>;

type MethodDef = AuthedHandler | { public: true; handler: PublicHandler };

type RouteContext = { params: Promise<Record<string, string | string[]>> };
type NextHandler = (req: Request, ctx: RouteContext) => Promise<Response>;

/**
 * Wraps route handlers with CORS, authentication (on by default), JSON
 * serialization and consistent error responses. Every route gets OPTIONS.
 */
export function route<M extends Partial<Record<Method, MethodDef>>>(
  defs: M,
): { [K in keyof M]: NextHandler } & { OPTIONS: NextHandler } {
  const out: Partial<Record<Method | 'OPTIONS', NextHandler>> = {};
  const methods = Object.keys(defs) as Method[];

  for (const method of methods) {
    const def = defs[method] as MethodDef;
    out[method] = async (req, ctx) => {
      try {
        const raw = ctx?.params ? await ctx.params : {};
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) params[k] = Array.isArray(v) ? v.join('/') : v;
        const url = new URL(req.url);
        const ip = clientIp(req) ?? 'local';
        // Rate limits: sign-in endpoints are tight; everything else is generous.
        if (typeof def !== 'function') rateLimit(`public:${ip}`, PUBLIC_PER_MIN, 60_000);
        else rateLimit(`api:${ip}`, API_PER_MIN, 60_000);
        let result: unknown;
        if (typeof def === 'function') {
          const auth = await authenticate(req);
          // Two-step sign-in not finished: only the authenticator-app screens (and "me" / sign out) work.
          if (auth.mfaPending && !MFA_OPEN.some((p) => url.pathname.startsWith(p)))
            throw new ApiError(403, auth.mfaPending === 'setup' ? 'mfa_setup_required' : 'mfa_required', auth.mfaPending === 'setup' ? 'Set up your authenticator app to continue.' : 'Enter the code from your authenticator app to continue.');
          result = await def({ req, url, params, auth });
        } else result = await def.handler({ req, url, params });
        const res = result instanceof Response ? result : Response.json(result ?? { ok: true });
        return withCors(req, res);
      } catch (err) {
        return withCors(req, errorResponse(err, req));
      }
    };
  }

  out.OPTIONS = async (req) =>
    withCors(
      req,
      new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-App, X-Client-Version, X-Company, X-Sync-Version',
          'Access-Control-Max-Age': '86400',
        },
      }),
    );
  return out as { [K in keyof M]: NextHandler } & { OPTIONS: NextHandler };
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest('Request body must be JSON.');
  }
  return schema.parse(body);
}

/** Multipart upload: the file in "file", the other fields as JSON in "data". */
export async function parseForm<T>(req: Request, schema: ZodType<T>, opts: { fileRequired?: boolean } = {}): Promise<{ data: T; file: File | null }> {
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest('Send the file as a form upload.');
  const raw = form.get('data');
  let body: unknown = {};
  if (typeof raw === 'string' && raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw badRequest('The form details could not be read.');
    }
  }
  const f = form.get('file');
  const file = f instanceof File && f.size > 0 ? f : null;
  if (opts.fileRequired && !file) throw badRequest('Choose a file to upload.');
  return { data: schema.parse(body), file };
}

export function clientIp(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}
