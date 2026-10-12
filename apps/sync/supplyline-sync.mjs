#!/usr/bin/env node
// SupplyLine Sync — runs on a PC on your network (Node 22 or newer, nothing else
// to install). When SupplyLine is hosted online it can't see your shared drives,
// so this app does the network-folder work for it:
//   1. Network filing: writes copies of new documents (order lists, BOLs, POs,
//      receiving photos, invoices…) into your folders by type.
//   2. AP inbox: sends invoices dropped into each company's AP inbox folder to
//      SupplyLine, then moves each file to In review / Approved / Rejected /
//      On hold as the invoice moves along.
//
// Setup: copy sync.config.example.json to sync.config.json, put in your
// SupplyLine address and the device key from Admin › Network filing & Sync.
//   node supplyline-sync.mjs           keep running (checks every minute)
//   node supplyline-sync.mjs --once    do one pass and stop (for Task Scheduler)
//   node supplyline-sync.mjs --test    check the address, key and folders

import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 'sync-1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.SUPPLYLINE_SYNC_CONFIG || path.join(HERE, 'sync.config.json');
const LOG_FILE = path.join(HERE, 'sync.log');
const STATE_FILE = path.join(HERE, 'sync.state.json');
const AP_TYPES = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Can't read ${CONFIG_FILE}: ${e.message}`);
  }
  const server = (process.env.SUPPLYLINE_URL || cfg.server || '').replace(/\/+$/, '');
  const key = process.env.SUPPLYLINE_SYNC_KEY || cfg.key || '';
  if (!server || !key) throw new Error(`Put "server" and "key" in ${CONFIG_FILE} (or set SUPPLYLINE_URL and SUPPLYLINE_SYNC_KEY).`);
  if (!key.startsWith('sls_')) throw new Error('The key should start with sls_ — copy it from Admin › Network filing & Sync.');
  return { server, key, intervalSeconds: Math.max(30, Number(cfg.intervalSeconds) || 60) };
}

async function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try {
    const st = await fs.stat(LOG_FILE).catch(() => null);
    if (st && st.size > 5 * 1_048_576) await fs.rename(LOG_FILE, `${LOG_FILE}.old`).catch(() => {});
    await fs.appendFile(LOG_FILE, line + '\r\n');
  } catch {
    /* logging must never stop the sync */
  }
}

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return { sent: {} };
  }
}
const saveState = (s) => fs.writeFile(STATE_FILE, JSON.stringify(s));

function client(cfg) {
  const headers = { Authorization: `Bearer ${cfg.key}`, 'X-Sync-Version': VERSION, 'X-Client-App': 'sync' };
  const call = async (method, p, body) => {
    const res = await fetch(cfg.server + p, { method, headers: body instanceof FormData ? headers : { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new Error(json?.error?.message || `${res.status} ${res.statusText}`);
    return json;
  };
  return {
    get: (p) => call('GET', p),
    post: (p, body) => call('POST', p, body),
    download: async (url) => {
      const res = await fetch(url.startsWith('http') ? url : cfg.server + url, { headers });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** Write under root without overwriting a different file of the same name. */
async function writeUnder(root, relativePath, bytes) {
  const target = path.join(root, ...relativePath.split('/'));
  if (!path.resolve(target).toLowerCase().startsWith(path.resolve(root).toLowerCase())) throw new Error('Bad path');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const ext = path.extname(target);
  let dest = target;
  for (let i = 1; i < 100; i++) {
    const existing = await fs.readFile(dest).catch(() => null);
    if (!existing) break;
    if (Buffer.compare(existing, Buffer.from(bytes)) === 0) return dest;
    dest = `${target.slice(0, target.length - ext.length)} (${i})${ext}`;
  }
  await fs.writeFile(dest, bytes);
  return dest;
}

/** Move a file into a folder, keeping its name (adds " (1)" if taken). */
async function moveInto(from, folder) {
  await fs.mkdir(folder, { recursive: true });
  const ext = path.extname(from);
  const name = path.basename(from, ext);
  let dest = path.join(folder, name + ext);
  for (let i = 1; i < 100; i++) {
    if (!(await fs.access(dest).then(() => true, () => false))) break;
    dest = path.join(folder, `${name} (${i})${ext}`);
  }
  try {
    await fs.rename(from, dest);
  } catch {
    await fs.copyFile(from, dest); // another drive / share
    await fs.unlink(from);
  }
  return dest;
}

async function fileDocuments(api, config) {
  const roots = new Map(config.companies.filter((c) => c.filing).map((c) => [c.id, c.filing.root]));
  const jobs = await api.get('/api/v1/sync/jobs');
  let done = 0;
  for (const j of jobs) {
    const root = roots.get(j.companyId);
    try {
      if (!root) throw new Error('No filing folder set for this company');
      const bytes = await api.download(j.url);
      const dest = await writeUnder(root, j.relativePath, bytes);
      await api.post(`/api/v1/sync/jobs/${j.id}/ack`, { ok: true });
      done++;
      await log(`filed ${dest}`);
    } catch (e) {
      await log(`could not file ${j.relativePath}: ${e.message}`);
      await api.post(`/api/v1/sync/jobs/${j.id}/ack`, { ok: false, error: e.message }).catch(() => {});
    }
  }
  return done;
}

async function apInboxes(api, config, state) {
  let sent = 0;
  for (const c of config.companies) {
    const inbox = c.apFolders?.inbox;
    if (!inbox) continue;
    let names;
    try {
      names = await fs.readdir(inbox);
    } catch (e) {
      await log(`${c.name}: can't open the AP inbox ${inbox} (${e.code || e.message})`);
      continue;
    }
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      if (!AP_TYPES.has(ext) || name.startsWith('~$') || name.startsWith('.')) continue;
      const full = path.join(inbox, name);
      try {
        const st = await fs.stat(full);
        if (!st.isFile() || Date.now() - st.mtimeMs < 5_000) continue; // still being copied in
        const bytes = await fs.readFile(full);
        const sum = createHash('sha256').update(bytes).digest('hex');
        if (state.sent[sum]) continue;
        const form = new FormData();
        form.set('companyId', c.id);
        form.set('sourcePath', full);
        form.set('file', new Blob([bytes]), name);
        const r = await api.post('/api/v1/sync/ap/upload', form);
        state.sent[sum] = r?.id || true;
        await saveState(state);
        if (!r?.duplicate) {
          sent++;
          await log(`${c.name}: sent invoice ${name}`);
        }
      } catch (e) {
        await log(`${c.name}: ${name} – ${e.message}`);
      }
    }
  }
  // Move invoice files to the folder that matches their status now.
  const moves = await api.get('/api/v1/sync/ap/moves');
  for (const m of moves) {
    try {
      if (!(await fs.access(m.from).then(() => true, () => false))) continue; // someone moved it by hand
      const dest = await moveInto(m.from, m.toFolder);
      await api.post(`/api/v1/sync/ap/moves/${m.id}`, { state: m.state, newPath: dest });
      await log(`moved ${path.basename(m.from)} → ${m.toFolder}`);
    } catch (e) {
      await log(`could not move ${m.from}: ${e.message}`);
    }
  }
  return sent;
}

async function pass(cfg) {
  const api = client(cfg);
  const config = await api.get('/api/v1/sync/config');
  const state = await loadState();
  const filed = await fileDocuments(api, config);
  const sent = await apInboxes(api, config, state);
  return { filed, sent };
}

async function test(cfg) {
  const api = client(cfg);
  const config = await api.get('/api/v1/sync/config');
  console.log(`Connected to ${cfg.server} (${VERSION}).`);
  for (const c of config.companies) {
    console.log(`\n${c.code} ${c.name}`);
    if (c.filing) {
      const ok = await fs.mkdir(c.filing.root, { recursive: true }).then(() => fs.access(c.filing.root)).then(() => true, (e) => e.message);
      console.log(`  Filing into ${c.filing.root}: ${ok === true ? 'OK' : ok}`);
    } else console.log('  Filing: not set to use the Sync app');
    if (c.apFolders?.inbox) {
      for (const [k, dir] of Object.entries(c.apFolders)) {
        if (!dir) continue;
        const ok = await fs.access(dir).then(() => true, (e) => e.code || e.message);
        console.log(`  AP ${k}: ${dir} ${ok === true ? 'OK' : `– ${ok}`}`);
      }
    } else console.log('  AP inbox: not set');
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const cfg = loadConfig();
  if (args.has('--test')) return test(cfg);
  if (args.has('--once')) {
    const r = await pass(cfg);
    await log(`pass done: ${r.filed} filed, ${r.sent} invoice(s) sent`);
    return;
  }
  await log(`SupplyLine Sync ${VERSION} started (every ${cfg.intervalSeconds}s) → ${cfg.server}`);
  for (;;) {
    try {
      const r = await pass(cfg);
      if (r.filed || r.sent) await log(`${r.filed} filed, ${r.sent} invoice(s) sent`);
    } catch (e) {
      await log(`problem: ${e.message} (will try again)`);
    }
    await new Promise((res) => setTimeout(res, cfg.intervalSeconds * 1000));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
