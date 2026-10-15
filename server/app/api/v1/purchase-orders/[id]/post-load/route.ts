import { postPoLoadInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { postPoToLoadBoard } from '@/services/po-bol';

// Put the PO's pickup on Bowron's load board (when the vendor isn't arranging shipping).
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => postPoToLoadBoard(auth, params.id!, await parseJson(req, postPoLoadInput)),
});
