"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { productImageDeliveryUrl } from "../../lib/cloudinary-url";
import { PRODUCT_IMAGE_HINT, PRODUCT_IMAGE_MIME_TYPES, productImageFileProblem } from "../../lib/products/product-image";
import { UPLOAD_ABORTED, browserUploadDeps, uploadProductImage } from "../../lib/products/product-image-upload";
import { Icon } from "../ui/Icon";

type ProductImageUploadProps = {
  /** The stored image URL ("" for none). Changes only after an upload is confirmed, or on Remove. */
  value: string;
  onChange: (url: string) => void;
  /** True while a file is uploading, so the form can wait before saving. */
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
};

type Upload =
  | { state: "idle" }
  | { state: "uploading"; file: File; preview: string; progress: number | null }
  | { state: "failed"; file: File; preview: string; error: string }
  | { state: "rejected"; error: string };

export function ProductImageUpload({ value, onChange, onBusyChange, disabled = false }: ProductImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const [upload, setUpload] = useState<Upload>({ state: "idle" });
  const [dragging, setDragging] = useState(false);
  const uploading = upload.state === "uploading";

  useEffect(() => { onBusyChange?.(uploading); }, [uploading, onBusyChange]);
  // Stop an upload if the form goes away, and release local previews.
  useEffect(() => () => abortRef.current?.(), []);
  const preview = upload.state === "uploading" || upload.state === "failed" ? upload.preview : null;
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function start(file: File, existingPreview?: string) {
    if (uploading) return; // one upload at a time
    const problem = productImageFileProblem(file);
    if (problem) {
      setUpload({ state: "rejected", error: problem });
      return;
    }
    const previewUrl = existingPreview ?? URL.createObjectURL(file);
    setUpload({ state: "uploading", file, preview: previewUrl, progress: null });
    try {
      const url = await uploadProductImage(file, (progress) => setUpload((current) => (current.state === "uploading" ? { ...current, progress } : current)), (abort) => { abortRef.current = abort; }, browserUploadDeps);
      abortRef.current = null;
      onChange(url);
      setUpload({ state: "idle" });
    } catch (error) {
      abortRef.current = null;
      if (error instanceof Error && error.message === UPLOAD_ABORTED) {
        // Cancelled: back to the previous photo (or none), nothing saved.
        setUpload({ state: "idle" });
        return;
      }
      setUpload({ state: "failed", file, preview: previewUrl, error: error instanceof Error ? error.message : "The upload failed." });
    }
  }

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) void start(file);
    if (inputRef.current) inputRef.current.value = ""; // choosing the same file again still fires
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled && !uploading) pick(event.dataTransfer.files);
  }

  const choose = () => inputRef.current?.click();
  const shown = preview ?? (value ? productImageDeliveryUrl(value) : null);
  const blocked = disabled || uploading;

  return (
    <div>
      <input ref={inputRef} type="file" accept={PRODUCT_IMAGE_MIME_TYPES.join(",")} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => pick(event.target.files)} disabled={blocked} />

      <div
        onDragOver={(event) => { event.preventDefault(); if (!blocked) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`grid gap-4 rounded-3xl border-2 border-dashed p-3 transition sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center sm:p-4 ${dragging ? "border-black bg-[#fff4c7]" : "border-black/15 bg-[#fbf9f3]"}`}
      >
        {/* Square frame; the photo keeps its own proportions inside it (never stretched or cropped). */}
        <div className="relative mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-2xl border border-black/5 bg-white">
          {shown ? (
            <Image src={shown} alt="Product photo preview" fill sizes="220px" unoptimized={Boolean(preview)} className={`object-contain p-2 ${uploading ? "opacity-60" : ""}`} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-black/45">
              <Icon name="image" className="h-8 w-8" />
              <span className="px-4 text-xs font-semibold">No photo yet</span>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-x-3 bottom-3 overflow-hidden rounded-full bg-black/10" aria-hidden="true">
              <div className="h-1.5 rounded-full bg-black transition-[width]" style={{ width: `${upload.progress ?? 8}%` }} />
            </div>
          )}
        </div>

        <div className="min-w-0 text-center sm:text-left" aria-live="polite">
          {uploading ? (
            <>
              <p role="status" className="text-sm font-black">Uploading… {upload.progress !== null ? `${upload.progress}%` : ""}</p>
              <p className="mt-1 text-xs text-black/55">Keep this page open. You can keep filling in the other fields.</p>
              <button type="button" onClick={() => abortRef.current?.()} className="mt-3 inline-flex min-h-10 items-center rounded-full border border-black/15 bg-white px-4 text-xs font-black">Cancel upload</button>
            </>
          ) : upload.state === "failed" ? (
            <>
              <p role="alert" className="text-sm font-black text-[#c92d24]">Upload failed</p>
              <p className="mt-1 text-xs leading-5 text-black/65">{upload.error} {value ? "The current photo is unchanged." : ""}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
                <button type="button" onClick={() => void start(upload.file, upload.preview)} disabled={disabled} className="pk-btn pk-btn-primary pk-btn-sm">Retry upload</button>
                <button type="button" onClick={choose} disabled={disabled} className="pk-btn pk-btn-secondary pk-btn-sm">Choose another</button>
                <button type="button" onClick={() => setUpload({ state: "idle" })} disabled={disabled} className="pk-btn pk-btn-ghost pk-btn-sm">{value ? "Keep current photo" : "Skip photo"}</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-black">{value ? "Photo ready" : "Drag a photo here"}</p>
              <p className="mt-1 text-xs text-black/55">{value ? "Saved with the product when you save." : "or choose one from this device."} {PRODUCT_IMAGE_HINT}</p>
              {upload.state === "rejected" && <p role="alert" className="mt-2 rounded-xl bg-[#ffe9e7] px-3 py-2 text-xs font-semibold text-[#a3241c]">{upload.error}</p>}
              <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
                <button type="button" onClick={choose} disabled={blocked} className="pk-btn pk-btn-primary pk-btn-sm">{value ? "Replace image" : "Choose image"}</button>
                {value && <button type="button" onClick={() => { onChange(""); setUpload({ state: "idle" }); }} disabled={blocked} className="pk-btn pk-btn-secondary pk-btn-sm">Remove image</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
