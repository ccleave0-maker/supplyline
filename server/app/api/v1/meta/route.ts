import type { ApiMeta } from '@supplyline/core/models';
import { route } from '@/lib/http';

export const { GET, OPTIONS } = route({
  GET: {
    public: true,
    handler: async (): Promise<ApiMeta> => ({
      apiVersion: 'v1',
      serverVersion: process.env.npm_package_version ?? '0.1.0',
      // Raise these to force older installed apps to update.
      minClientVersion: { web: '0.0.0', pc: '0.0.0', ios: '0.0.0', android: '0.0.0' },
    }),
  },
});
