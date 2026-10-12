// Device-feature interfaces. `core` only ever talks to these; each app in apps/
// supplies its own implementation (browser APIs, Capacitor plugins, Tauri commands).
// Permissions, deep links and push setup live in each app, never here or in core.

export type AppKind = 'web' | 'pc' | 'ios' | 'android';

export interface AppInfo {
  app: AppKind;
  version: string;
  apiBaseUrl: string;
}

export interface PickedFile {
  name: string;
  mimeType: string;
  blob: Blob;
}

export interface CameraService {
  /** Opens the camera (or a picker on devices without one). Returns null if cancelled. */
  takePhoto(): Promise<PickedFile | null>;
  /** Pick existing photos from the gallery / disk. */
  pickImages(options?: { multiple?: boolean }): Promise<PickedFile[]>;
}

export interface FileService {
  pickFiles(options?: { accept?: string; multiple?: boolean }): Promise<PickedFile[]>;
  /** Save to disk (PC: save dialog; mobile: share/save sheet; web: download). */
  saveFile(fileName: string, blob: Blob): Promise<void>;
}

export interface PrintService {
  /** Native print dialog for a PDF. */
  printPdf(pdf: Blob, title?: string): Promise<void>;
}

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface PushService {
  permissionState(): Promise<PermissionState>;
  /** Ask for permission (only when the user turns notifications on) and return a device token. */
  register(): Promise<string | null>;
}

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracyMeters: number | null;
}

export interface LocationService {
  /** Requests permission at the moment of use. Returns null if denied/unavailable. */
  getCurrentPosition(): Promise<GeoPosition | null>;
}

export interface ShareService {
  canShare(): boolean;
  share(data: { title?: string; text?: string; url?: string; files?: File[] }): Promise<boolean>;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Listening {
  /** Words heard so far (updates while talking) */
  onPartial(cb: (text: string) => void): void;
  /** Stop and get the final words (null if nothing was heard / cancelled) */
  stop(): Promise<string | null>;
  cancel(): void;
}

export interface Recording {
  /** Stop and get the audio */
  stop(): Promise<Blob | null>;
  cancel(): void;
}

export interface SpeechToTextService {
  /** The device itself can turn speech into text */
  isAvailable(): Promise<boolean>;
  /** Start listening; call stop() when the person is done talking. Null if not available / not allowed. */
  start(options?: { language?: string }): Promise<Listening | null>;
  /** Record audio from the microphone (for server-side transcription when the device can't). */
  record(): Promise<Recording | null>;
}

export interface Platform {
  info: AppInfo;
  camera: CameraService;
  files: FileService;
  print: PrintService;
  push: PushService;
  location: LocationService;
  share: ShareService;
  /** Login token storage. Native apps use the OS keychain/keystore. */
  secureStore: KeyValueStore;
  /** Non-secret preferences (last company, UI choices). */
  prefs: KeyValueStore;
  speech: SpeechToTextService;
  openExternal(url: string): Promise<void>;
}

export { PlatformProvider, usePlatform } from './context';
