import { verifiedUploadUrl } from "./product-image";

type Credentials = { cloudName: string; apiKey: string; timestamp: number; folder: string; allowedFormats: string; signature: string };

/** The parts of XMLHttpRequest the upload uses, so tests can stand in for the network. */
export type UploadRequest = {
  open(method: string, url: string): void;
  send(body: FormData): void;
  abort(): void;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  status: number;
  responseText: string;
};

export type UploadDeps = {
  fetch: (url: string, init: { method: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  createRequest: () => UploadRequest;
};

export const UPLOAD_ABORTED = "ABORTED";

/**
 * One product photo upload: signed credentials from PackAM, then a direct upload to Cloudinary with
 * progress. Resolves to the image URL only after Cloudinary's answer is verified; rejects with a message
 * an admin can act on (or UPLOAD_ABORTED when cancelled). Nothing is saved to a product here.
 */
export function uploadProductImage(file: File, onProgress: (percent: number) => void, register: (abort: () => void) => void, deps: UploadDeps) {
  return new Promise<string>((resolve, reject) => {
    let aborted = false;
    register(() => { aborted = true; reject(new Error(UPLOAD_ABORTED)); });
    deps.fetch("/api/admin/product-images", { method: "POST" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Image upload is temporarily unavailable. Try again.");
        return data as unknown as Credentials;
      }, () => { throw new Error("Couldn’t reach PackAM to start the upload. Check your connection and retry."); })
      .then((credentials) => {
        if (aborted) return;
        const body = new FormData();
        body.set("api_key", credentials.apiKey);
        body.set("timestamp", String(credentials.timestamp));
        body.set("signature", credentials.signature);
        body.set("folder", credentials.folder);
        body.set("allowed_formats", credentials.allowedFormats);
        body.set("file", file);
        const request = deps.createRequest();
        register(() => request.abort());
        request.open("POST", `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/image/upload`);
        request.upload.onprogress = (event) => { if (event.lengthComputable && event.total > 0) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100))); };
        request.onerror = () => reject(new Error("The image couldn’t reach image storage. Check your connection and retry."));
        request.onabort = () => reject(new Error(UPLOAD_ABORTED));
        request.onload = () => {
          let result: unknown = null;
          try { result = JSON.parse(request.responseText); } catch { /* handled below */ }
          if (request.status < 200 || request.status >= 300) {
            const message = (result as { error?: { message?: unknown } } | null)?.error?.message;
            reject(new Error(typeof message === "string" ? `Image storage refused the file: ${message}` : "Image storage didn’t accept this file. Try again."));
            return;
          }
          const verified = verifiedUploadUrl(result, credentials.cloudName);
          if (verified.ok) resolve(verified.url);
          else reject(new Error(verified.reason));
        };
        request.send(body);
      })
      .catch((error: unknown) => reject(error instanceof Error ? error : new Error("The upload failed. Try again.")));
  });
}

export const browserUploadDeps: UploadDeps = {
  fetch: (url, init) => fetch(url, init),
  createRequest: () => new XMLHttpRequest() as unknown as UploadRequest,
};
