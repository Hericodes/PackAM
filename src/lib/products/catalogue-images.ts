import "server-only";

import { isPackamProductImageUrl } from "../cloudinary-url";
import { verifyProductImageForSave } from "./product-image-server";

/** A new catalogue image must be a real image in PackAM's image storage; keeping the current one needs no check. */
export async function checkCatalogueImage(url: string | null | undefined, current: string | null): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!url || url === current) return { ok: true };
  if (!isPackamProductImageUrl(url, process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME)) return { ok: false, status: 400, error: "Choose a PackAM photo." };
  const image = await verifyProductImageForSave(url);
  return image.ok ? { ok: true } : { ok: false, status: image.status, error: image.error };
}
