import { Capacitor } from '@capacitor/core';
import type { CameraService, PickedFile, Platform } from '@supplyline/platform';
import { createBrowserPlatform } from '@supplyline/platform/browser';

// iPhone/iPad (Capacitor). Starts from browser APIs and swaps in the native camera.
// Keychain token storage, push (APNs), files and share sheet follow in the Apps phase.
// Permission prompts are requested only when used (wording is in Info.plist).
const base = createBrowserPlatform({
  app: 'ios',
  version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0',
  apiBaseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
});

// Photos are scaled to at most 2400 px and saved as JPEG: sharp enough for packing slips,
// BOLs and QR codes, and quick to upload on a site connection.
const MAX_SIDE = 2400;
const QUALITY = 80;

/** Cancelling the camera or picker isn't an error; the screen just carries on. */
function cancelled(e: unknown) {
  return /cancel|denied by user|no image picked|user cancelled/i.test(String((e as { message?: string })?.message ?? e));
}

async function toPicked(webPath: string | undefined, name: string): Promise<PickedFile | null> {
  if (!webPath) return null;
  const blob = await (await fetch(webPath)).blob();
  return { name, mimeType: blob.type || 'image/jpeg', blob };
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);

const nativeCamera: CameraService = {
  async takePhoto() {
    const { Camera } = await import('@capacitor/camera');
    try {
      const r = await Camera.takePhoto({ quality: QUALITY, targetWidth: MAX_SIDE, targetHeight: MAX_SIDE, correctOrientation: true });
      return await toPicked(r.webPath, `photo-${stamp()}.jpg`);
    } catch (e) {
      if (cancelled(e)) return null;
      throw permissionHelp(e, 'camera');
    }
  },
  async pickImages(o) {
    const { Camera, MediaTypeSelection } = await import('@capacitor/camera');
    try {
      const multiple = o?.multiple ?? true;
      const r = await Camera.chooseFromGallery({ mediaType: MediaTypeSelection.Photo, allowMultipleSelection: multiple, limit: multiple ? 20 : 1, quality: QUALITY, targetWidth: MAX_SIDE });
      const files = await Promise.all(r.results.map((m, i) => toPicked(m.webPath, `photo-${stamp()}-${i + 1}.jpg`)));
      return files.filter((f): f is PickedFile => f != null);
    } catch (e) {
      if (cancelled(e)) return [];
      throw permissionHelp(e, 'photos');
    }
  },
};

/** A blocked permission becomes a message that says how to turn it back on. */
function permissionHelp(e: unknown, what: 'camera' | 'photos') {
  const msg = String((e as { message?: string })?.message ?? e);
  if (/permission|denied|access|not authorized/i.test(msg)) {
    return new Error(`Bowron isn't allowed to use your ${what === 'camera' ? 'camera' : 'photos'}. Turn it on in Settings › Bowron, then try again.`);
  }
  return e instanceof Error ? e : new Error(msg);
}

// ---------------------------------------------------------------------------
// Files: the web page can't download or print inside the app, so a PDF or export is
// written to the app's cache and handed to the iPhone share sheet (Save to Files,
// Print, Mail, AirDrop...).
// ---------------------------------------------------------------------------
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error ?? new Error('Couldn’t read the file.'));
    r.readAsDataURL(blob);
  });
}

async function shareBlob(fileName: string, blob: Blob, title?: string) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const safe = fileName.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'file';
  const { uri } = await Filesystem.writeFile({ path: safe, data: await blobToBase64(blob), directory: Directory.Cache });
  try {
    await Share.share({ title: title ?? safe, files: [uri], dialogTitle: title ?? safe });
  } catch (e) {
    if (!cancelled(e)) throw e;
  }
}

const native = Capacitor.isNativePlatform();

export const platform: Platform = {
  ...base,
  camera: native ? nativeCamera : base.camera,
  files: native ? { ...base.files, saveFile: (name, blob) => shareBlob(name, blob) } : base.files,
  print: native ? { printPdf: (pdf, title) => shareBlob(`${title ?? 'document'}.pdf`.replace(/\.pdf\.pdf$/i, '.pdf'), pdf, title ?? 'Print') } : base.print,
  share: native
    ? {
        canShare: () => true,
        async share(data) {
          const { Share } = await import('@capacitor/share');
          try {
            const file = data.files?.[0];
            if (file) await shareBlob(file.name, file, data.title);
            else await Share.share({ title: data.title, text: data.text, url: data.url });
            return true;
          } catch {
            return false;
          }
        },
      }
    : base.share,
};
