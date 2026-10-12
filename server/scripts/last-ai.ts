// Dev helper: the latest assistant messages and AI requests (no keys or secrets are printed).
import 'dotenv/config';
import { db } from '../src/lib/db';

const msgs = await db.assistantMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 12, select: { role: true, text: true, action: true, actionStatus: true, unanswered: true, createdAt: true } });
console.log(JSON.stringify(msgs.reverse(), null, 1));
const logs = await db.aiRequestLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10, select: { screen: true, error: true, summary: true, transcript: true, createdAt: true, model: true } });
console.log(JSON.stringify(logs, null, 1));
await db.$disconnect();
