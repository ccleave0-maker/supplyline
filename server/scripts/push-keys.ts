// Makes the Web Push key pair and adds it to server/.env (only if it isn't there yet).
// The private key is written to the file, never printed.
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';

const file = path.resolve(process.cwd(), '.env');
const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
if (/^VAPID_PRIVATE_KEY=.+/m.test(current)) {
  console.log('Push keys are already in .env — nothing changed.');
} else {
  const k = webpush.generateVAPIDKeys();
  appendFileSync(file, `\n# Web Push (browser / installed app notifications)\nVAPID_PUBLIC_KEY="${k.publicKey}"\nVAPID_PRIVATE_KEY="${k.privateKey}"\n`);
  console.log('Push keys added to .env. For the live server, run this once there (or copy both values into the host settings).');
}
