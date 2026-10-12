import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../lib/env';

export type StorageKind = 'LOCAL' | 'SUPABASE' | 'SHAREPOINT' | 'GOOGLE_DRIVE';

/** One interface for every place files can live. Add a provider = add a class. */
export interface StorageProvider {
  kind: StorageKind;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ externalId: string | null }>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

const LOCAL_ROOT = path.resolve(process.cwd(), '.storage');

function safeLocalPath(key: string): string {
  const full = path.resolve(LOCAL_ROOT, key);
  if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error('Invalid storage key');
  return full;
}

/** Development only: files under server/.storage */
export const localStorageProvider: StorageProvider = {
  kind: 'LOCAL',
  async put(key, bytes) {
    const full = safeLocalPath(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    return { externalId: null };
  },
  async get(key) {
    return new Uint8Array(await readFile(safeLocalPath(key)));
  },
  async remove(key) {
    await rm(safeLocalPath(key), { force: true });
  },
};

/** Supabase Storage (default in production). Private bucket; the server streams files. */
export const supabaseStorageProvider: StorageProvider = {
  kind: 'SUPABASE',
  async put(key, bytes, contentType) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET } = env();
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${encodeURI(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'true',
      },
      body: bytes as unknown as BodyInit,
    });
    if (!res.ok) throw new Error(`Supabase upload failed (${res.status}): ${await res.text()}`);
    return { externalId: null };
  },
  async get(key) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET } = env();
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${encodeURI(key)}`, {
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!res.ok) throw new Error(`Supabase download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  },
  async remove(key) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET } = env();
    await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [key] }),
    });
  },
};

// SharePoint and Google Drive connectors are added in the Exports phase.
export function storageFor(kind: StorageKind): StorageProvider {
  switch (kind) {
    case 'LOCAL':
      return localStorageProvider;
    case 'SUPABASE':
      return supabaseStorageProvider;
    default:
      throw new Error(`Storage provider ${kind} is not connected yet`);
  }
}

export function defaultStorage(): StorageProvider {
  return env().STORAGE_PROVIDER === 'supabase' ? supabaseStorageProvider : localStorageProvider;
}
