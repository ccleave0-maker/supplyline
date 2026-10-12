import { z } from 'zod';
import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { currentDesktopRelease, publishDesktopRelease } from '@/services/app-updates';
import { requirePermission } from '@/lib/auth';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth }) => {
    requirePermission(auth, 'platform:manage');
    const r = await currentDesktopRelease();
    return r ? { version: r.version, notes: r.notes, pubDate: r.pubDate } : null;
  },
  // Multipart: installer (the …-setup.exe), signature (text of the .sig file), version, notes
  POST: async ({ req, auth }) => {
    const form = await req.formData().catch(() => null);
    const installer = form?.get('installer');
    if (!(installer instanceof File) || installer.size === 0) throw badRequest('Choose the installer.');
    const b = z.object({ version: z.string().trim(), notes: z.string().default(''), signature: z.string() }).parse({ version: form?.get('version'), notes: form?.get('notes') ?? '', signature: form?.get('signature') });
    return publishDesktopRelease(auth, { version: b.version, notes: b.notes }, installer, b.signature);
  },
});
