import { BRANDING_IMAGE_KINDS, type BrandingImageKind } from '@supplyline/core/models';
import { badRequest, notFound } from '@/lib/errors';
import { route } from '@/lib/http';
import { setBrandingImage } from '@/services/companies';

function kindOf(raw: string | undefined): BrandingImageKind {
  if (!raw || !(BRANDING_IMAGE_KINDS as readonly string[]).includes(raw)) throw notFound('Image slot');
  return raw as BrandingImageKind;
}

// PUT multipart/form-data with a "file" field. DELETE clears the slot.
export const { PUT, DELETE, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw badRequest('Choose an image to upload.');
    return setBrandingImage(auth, params.id!, kindOf(params.kind), file);
  },
  DELETE: async ({ auth, params }) => setBrandingImage(auth, params.id!, kindOf(params.kind), null),
});
