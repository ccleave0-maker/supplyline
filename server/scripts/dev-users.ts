// Dev helper: active users, their roles and whether they use two-step sign-in (no secrets printed).
import 'dotenv/config';
import { db } from '../src/lib/db';

const users = await db.user.findMany({ where: { active: true, deletedAt: null }, take: 15, select: { email: true, roles: true, mfaEnabledAt: true } });
console.log(JSON.stringify(users, null, 1));
await db.$disconnect();
