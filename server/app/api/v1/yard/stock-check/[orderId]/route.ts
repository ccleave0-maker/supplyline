import { stockCheckInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getStockCheck, saveStockCheck } from '@/services/yard';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, params }) => getStockCheck(auth, params.orderId!),
  POST: async ({ req, auth, params }) => saveStockCheck(auth, params.orderId!, await parseJson(req, stockCheckInput)),
});
