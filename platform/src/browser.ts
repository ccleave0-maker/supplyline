// A standards-based implementation using only browser APIs. The web app uses it
// as-is; native apps start from it and replace pieces with native plugins.
import type { AppInfo, KeyValueStore, PickedFile, Platform } from './index';

function pickWithInput(accept: string, multiple: boolean, capture?: string): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    let settled = false;
    const done = (files: PickedFile[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => {
      done(Array.from(input.files ?? []).map((f) => ({ name: f.name, mimeType: f.type, blob: f })));
    });
    input.addEventListener('cancel', () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

export function localStorageStore(prefix: string): KeyValueStore {
  return {
    async get(key) {
      try {
        return window.localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      try {
        window.localStorage.setItem(prefix + key, value);
      } catch {
        /* storage unavailable (private mode) — keep working without it */
      }
    },
    async remove(key) {
      try {
        window.localStorage.removeItem(prefix + key);
      } catch {
        /* ignore */
      }
    },
  };
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function createBrowserPlatform(info: AppInfo): Platform {
  return {
    info,
    camera: {
      async takePhoto() {
        const [file] = await pickWithInput('image/*', false, 'environment');
        return file ?? null;
      },
      pickImages: (o) => pickWithInput('image/*', o?.multiple ?? true),
    },
    files: {
      pickFiles: (o) => pickWithInput(o?.accept ?? '*/*', o?.multiple ?? false),
      async saveFile(fileName, blob) {
        downloadBlob(fileName, blob);
      },
    },
    print: {
      async printPdf(pdf) {
        const url = URL.createObjectURL(pdf);
        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        frame.src = url;
        document.body.appendChild(frame);
        await new Promise<void>((r) => frame.addEventListener('load', () => r(), { once: true }));
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        setTimeout(() => {
          frame.remove();
          URL.revokeObjectURL(url);
        }, 60_000);
      },
    },
    push: {
      async permissionState() {
        if (typeof Notification === 'undefined') return 'unsupported';
        return Notification.permission === 'default' ? 'prompt' : Notification.permission;
      },
      async register() {
        // Web push wiring arrives with the notifications phase.
        return null;
      },
    },
    location: {
      getCurrentPosition() {
        return new Promise((resolve) => {
          if (!('geolocation' in navigator)) return resolve(null);
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyMeters: p.coords.accuracy }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 15_000 },
          );
        });
      },
    },
    share: {
      canShare: () => typeof navigator !== 'undefined' && 'share' in navigator,
      async share(data) {
        try {
          await navigator.share(data);
          return true;
        } catch {
          return false;
        }
      },
    },
    secureStore: localStorageStore('sl.secure.'),
    prefs: localStorageStore('sl.pref.'),
    speech: {
      async isAvailable() {
        return typeof window !== 'undefined' && !!speechRecognitionCtor();
      },
      async start(options) {
        const Ctor = speechRecognitionCtor();
        if (!Ctor) return null;
        const rec = new Ctor();
        rec.lang = options?.language ?? 'en-CA';
        rec.continuous = true;
        rec.interimResults = true;
        let finalText = '';
        let partial = '';
        let onPartial: (t: string) => void = () => {};
        let done: ((t: string | null) => void) | null = null;
        let failed = false;
        rec.onresult = (e: SpeechRecognitionEventLike) => {
          partial = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]!;
            if (r.isFinal) finalText += r[0]!.transcript + ' ';
            else partial += r[0]!.transcript;
          }
          onPartial((finalText + partial).trim());
        };
        rec.onerror = () => {
          failed = true;
        };
        rec.onend = () => done?.(failed && !finalText ? null : (finalText + partial).trim() || null);
        try {
          rec.start();
        } catch {
          return null;
        }
        return {
          onPartial(cb) {
            onPartial = cb;
          },
          stop() {
            return new Promise<string | null>((resolve) => {
              done = resolve;
              rec.stop();
            });
          },
          cancel() {
            done = null;
            rec.abort();
          },
        };
      },
      async record() {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return null;
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch {
          return null;
        }
        const chunks: Blob[] = [];
        const mr = new MediaRecorder(stream);
        mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        mr.start();
        const end = () => stream.getTracks().forEach((t) => t.stop());
        return {
          stop() {
            return new Promise<Blob | null>((resolve) => {
              mr.onstop = () => {
                end();
                resolve(chunks.length ? new Blob(chunks, { type: mr.mimeType || 'audio/webm' }) : null);
              };
              mr.stop();
            });
          },
          cancel() {
            mr.onstop = () => end();
            mr.stop();
          },
        };
      },
    },
    async openExternal(url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } } & ArrayLike<{ transcript: string }>>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
