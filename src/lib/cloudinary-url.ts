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
