import { route } from '@/lib/http';
import { poForBol } from '@/services/po-bol';

// Where each line of this PO is: in a yard, at the vendor, or still to pick up.
export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => poForBol(auth, params.poId!),
});
