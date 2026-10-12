import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { accountingExport } from '@/services/accounting';

// AP register, AR register or tax summary rows (the app turns them into Excel / PDF).
export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const kind = url.searchParams.get('kind');
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    if (kind !== 'ap' && kind !== 'ar' && kind !== 'tax') throw badRequest('Choose AP, AR or tax.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest('Choose the dates.');
    return accountingExport(auth, kind, from, to, url.searchParams.get('companyId') ?? undefined);
  },
});
