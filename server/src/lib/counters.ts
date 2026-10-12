import type { Db, Tx } from './db';

/**
 * Atomically returns the next value of a named sequence (1, 2, 3 …).
 * Safe under concurrent submits: the row is locked by the upsert.
 */
export async function nextCounter(tx: Tx | Db, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return rows[0]!.value;
}
