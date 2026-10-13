import { customValueInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { setCustomValue } from '@/services/procurement';

export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => {
    const { value } = await parseJson(req, customValueInput);
    return setCustomValue(auth, params.id!, params.columnId!, value);
  },
});
