// Builds the Windows installer. When the update-signing key is on this PC
// (default: %USERPROFILE%\.supplyline-keys\supplyline-updater.key, or TAURI_SIGNING_PRIVATE_KEY),
// it also makes the signed update files the auto-updater needs. Without it,
// the installer is still built — just without update files.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = { ...process.env };
const keyFile = process.env.SUPPLYLINE_UPDATER_KEY || path.join(os.homedir(), '.supplyline-keys', 'supplyline-updater.key');
const args = ['tauri', 'build'];
if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(keyFile)) {
  env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyFile, 'utf8').trim();
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= '';
}
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  console.log('No update-signing key on this PC: building the installer without update files.');
  args.push('--config', JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
}
const r = spawnSync('pnpm', ['exec', ...args], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
