import { createHash, randomUUID } from 'node:crypto';
import type { FileKind } from '../generated/prisma/client';
import { db } from '../lib/db';
import { signFilePath } from '../lib/crypto';
import { badRequest } from '../lib/errors';
import { defaultStorage, storageFor } from '../integrations/storage';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

export async function saveUpload(opts: {
  organizationId: string;
  companyId: string | null;
  uploadedById: string;
  kind: FileKind;
  file: File;
  maxBytes: number;
  imagesOnly?: boolean;
}) {
  const { file } = opts;
  if (file.size === 0) throw badRequest('The file is empty.');
  if (file.size > opts.maxBytes) throw badRequest(`File is too large (max ${Math.round(opts.maxBytes / 1_048_576)} MB).`);
  if (opts.imagesOnly && !IMAGE_TYPES.includes(file.type)) throw badRequest('Upload a PNG, JPG, WEBP or SVG image.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const storage = defaultStorage();
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  const key = `${opts.organizationId}/${opts.kind.toLowerCase()}/${randomUUID()}.${ext}`;
  const { externalId } = await storage.put(key, bytes, file.type || 'application/octet-stream');

  return db.fileAsset.create({
    data: {
      organizationId: opts.organizationId,
      companyId: opts.companyId,
      provider: storage.kind,
      storageKey: key,
      externalId,
      fileName: file.name.slice(0, 200),
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      checksum: createHash('sha256').update(bytes).digest('hex'),
      kind: opts.kind,
      uploadedById: opts.uploadedById,
    },
  });
}

export async function readFileAsset(fileId: string) {
  const file = await db.fileAsset.findUnique({ where: { id: fileId } });
  if (!file || file.deletedAt) return null;
  const bytes = await storageFor(file.provider).get(file.storageKey);
  return { file, bytes };
}

export const fileUrl = (fileId: string | null | undefined) => (fileId ? signFilePath(fileId) : null);

/** A company logo in a form the PDF renderer can use (PNG / JPG; SVG and WebP are converted). */
export async function logoForPdf(logoFileId: string | null): Promise<{ data: Buffer; format: 'png' | 'jpg' } | null> {
  if (!logoFileId) return null;
  const f = await readFileAsset(logoFileId).catch(() => null);
  if (!f) return null;
  // SVG / WebP logos are turned into PNG so they print on PDFs too.
  if (f.file.mimeType === 'image/svg+xml' || f.file.mimeType === 'image/webp') {
    try {
      const { default: sharp } = await import('sharp');
      return { data: await sharp(Buffer.from(f.bytes), { density: 300 }).resize({ height: 300, withoutEnlargement: false }).png().toBuffer(), format: 'png' };
    } catch {
      return null;
    }
  }
  if (f.file.mimeType !== 'image/png' && f.file.mimeType !== 'image/jpeg') return null;
  return { data: Buffer.from(f.bytes), format: f.file.mimeType === 'image/png' ? 'png' : 'jpg' };
}
