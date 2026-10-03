"use client";

import { CldUploadWidget } from "next-cloudinary";
import Image from "next/image";

type ProductImageUploadProps = {
  value: string;
  onChange: (url: string) => void;
};

export function ProductImageUpload({
  value,
  onChange,
}: ProductImageUploadProps) {
  return (
    <div>
      <CldUploadWidget
        signatureEndpoint="/api/sign-cloudinary-params"
        options={{
          multiple: false,
          maxFiles: 1,
          resourceType: "image",
          clientAllowedFormats: ["jpg", "jpeg", "png", "webp"],
          maxFileSize: 5_000_000,
          folder: "packam/products",
        }}
        onSuccess={(result) => {
          if (
            typeof result.info === "object" &&
            result.info !== null &&
            "secure_url" in result.info
          ) {
            const secureUrl = result.info.secure_url;

            if (typeof secureUrl === "string") {
              onChange(secureUrl);
            }
          }
        }}
      >
        {({ open }) => (
          <button
            type="button"
            onClick={() => open()}
            className="w-full overflow-hidden rounded-3xl border border-dashed border-black/15 bg-[#f7f5ee] text-left transition hover:border-black/30 hover:bg-[#f2efe6]"
          >
            {value ? (
              <div>
                <div className="relative aspect-square w-full overflow-hidden">
                  <Image
                    src={value}
                    alt="Product preview"
                    fill
                    className="object-cover"
                  />
                </div>

                <div className="flex items-center justify-between px-5 py-4">
                  <div>
                    <p className="text-sm font-black">
                      Product image uploaded
                    </p>

                    <p className="mt-1 text-xs text-black/40">
                      Click to replace the image
                    </p>
                  </div>

                  <span className="rounded-full bg-black px-4 py-2 text-xs font-black text-white">
                    Change
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#feb80a] text-3xl">
                  📷
                </div>

                <p className="mt-5 text-base font-black">
                  Upload product image
                </p>

                <p className="mt-2 max-w-xs text-xs leading-5 text-black/40">
                  JPG, PNG or WebP. Maximum 5MB.
                </p>

                <span className="mt-5 rounded-full bg-black px-5 py-2.5 text-xs font-black text-white">
                  Choose Image
                </span>
              </div>
            )}
          </button>
        )}
      </CldUploadWidget>
    </div>
  );
}