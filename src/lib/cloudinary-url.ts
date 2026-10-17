export function isPackamProductImageUrl(value: string | null | undefined, cloudName: string | undefined) {
  if (!value) return true;
  if (!cloudName || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && url.pathname.startsWith(`/${cloudName}/image/upload/`);
  } catch {
    return false;
  }
}

/**
 * Delivery URL for a stored Cloudinary product image: asks Cloudinary for a size-limited, compressed
 * rendition so Next's image optimizer is not left downloading multi-megabyte originals (which can
 * exceed its upstream timeout and break the image). The stored URL is unchanged; URLs that already
 * carry a transformation, or are not Cloudinary uploads, are returned as-is.
 */
export function productImageDeliveryUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.hostname !== "res.cloudinary.com") return value;
    const marker = "/image/upload/";
    const at = url.pathname.indexOf(marker);
    if (at === -1) return value;
    const rest = url.pathname.slice(at + marker.length);
    const firstSegment = rest.split("/")[0] ?? "";
    // Transformation segments look like "c_fill,w_400"; versions look like "v1792244922".
    if (/^[a-z]{1,3}_[^/]*$/i.test(firstSegment) && !/^v\d+$/.test(firstSegment)) return value;
    url.pathname = `${url.pathname.slice(0, at + marker.length)}c_limit,w_1600,f_auto,q_auto/${rest}`;
    return url.toString();
  } catch {
    return value;
  }
}
