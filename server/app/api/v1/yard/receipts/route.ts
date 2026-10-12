import { receiptInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createReceipt, listReceipts } from '@/services/yard';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => listReceipts(auth, url.searchParams.get('yardId') || undefined),
  POST: async ({ req, auth }) => createReceipt(auth, await parseJson(req, receiptInput)),
});
