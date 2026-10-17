"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { productImageDeliveryUrl } from "../../lib/cloudinary-url";
import { photoFit, type PhotoFit } from "../../lib/products/photo-fit";

function measure(img: HTMLImageElement, frame: HTMLElement | null): PhotoFit {
  const box = frame?.getBoundingClientRect();
  return photoFit(img.naturalWidth, img.naturalHeight, box && box.height ? box.width / box.height : 4 / 3);
}

/**
 * A real product photo that always fills its frame. Once the photo loads, its shape is compared with the
 * frame: a similar shape fills edge to edge (cover); a different shape stays whole (contain) over a
 * blurred copy of itself, so nothing important is cropped and no empty margin is left around it.
 * If the photo cannot be loaded, `fallback` (the product's illustration) is shown instead.
 */
export function ProductPhoto({ src, alt, sizes, priority, fallback }: { src: string; alt: string; sizes: string; priority?: boolean; fallback: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<PhotoFit | null>(null);
  const [failed, setFailed] = useState(false);
  const delivery = productImageDeliveryUrl(src);

  // An image that finished (or failed) before hydration fires no event React can see; check it directly.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const img = frameRef.current?.querySelector<HTMLImageElement>(`img[alt="${CSS.escape(alt)}"]`);
      if (!img?.complete) return;
      if (img.naturalWidth === 0) setFailed(true);
      else setFit((current) => current ?? measure(img, frameRef.current));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [alt, delivery]);

  if (failed) return <>{fallback}</>;

  return (
    <div ref={frameRef} className="absolute inset-0">
      {fit === "contain" && (
        <>
          {/* Same URL and sizes as the photo below, so the browser reuses the cached image. */}
          <Image src={delivery} alt="" aria-hidden="true" fill sizes={sizes} className="scale-125 object-cover opacity-80 blur-2xl saturate-150" />
          <div className="absolute inset-0 bg-white/20" aria-hidden="true" />
        </>
      )}
      <Image
        src={delivery}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        onLoad={(event) => setFit(measure(event.currentTarget, frameRef.current))}
        onError={() => setFailed(true)}
        className={`transition-opacity duration-300 ${fit === null ? "pk-photo-pending" : "opacity-100"} ${
          fit === "contain" ? "object-contain drop-shadow-[0_10px_22px_rgba(8,8,8,0.22)]" : "object-cover object-center"
        }`}
      />
    </div>
  );
}
