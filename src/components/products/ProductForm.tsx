"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductImageUpload } from "./ProductImageUpload";

type Category = {
  id: string;
  name: string;
};

type ProductFormProps = {
  categories: Category[];
  initialData?: {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    categoryId: string;
    customerPrice: number;
    status: "ACTIVE" | "INACTIVE";
  };
};

export function ProductForm({
  categories,
  initialData,
}: ProductFormProps) {
  const router = useRouter();

  const [name, setName] = useState(initialData?.name ?? "");

  const [description, setDescription] = useState(
    initialData?.description ?? "",
  );

  const [imageUrl, setImageUrl] = useState(
    initialData?.imageUrl ?? "",
  );

  const [categoryId, setCategoryId] = useState(
    initialData?.categoryId ?? "",
  );

  const [customerPrice, setCustomerPrice] = useState(
    initialData?.customerPrice?.toString() ?? "",
  );

  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">(
    initialData?.status ?? "ACTIVE",
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isEditing = Boolean(initialData?.id);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError("");

    if (!name.trim()) {
      setError("Please enter a product name.");
      return;
    }

    if (!categoryId) {
      setError("Please select a category.");
      return;
    }

    const price = Number(customerPrice);

    if (!Number.isSafeInteger(price) || price < 0) {
      setError("Please enter a whole-naira price.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        initialData
          ? `/api/products/${initialData.id}`
          : "/api/products",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim(),
            imageUrl,
            categoryId,
            customerPrice: price,
            status,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Something went wrong.",
        );
      }

      router.push(
        window.location.pathname.includes("/runner/")
          ? "/runner/products"
          : "/admin/products",
      );

      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6"
    >
      {/* ERROR */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {/* PRODUCT NAME */}
      <div>
        <label
          htmlFor="name"
          className="mb-2 block text-sm font-black"
        >
          Product name
        </label>

        <input
          id="name"
          type="text"
          value={name}
          onChange={(event) =>
            setName(event.target.value)
          }
          placeholder="e.g. A4 Project File"
          className="packam-input"
          disabled={loading}
        />
      </div>

      {/* CATEGORY */}
      <div>
        <label
          htmlFor="category"
          className="mb-2 block text-sm font-black"
        >
          Category
        </label>

        <select
          id="category"
          value={categoryId}
          onChange={(event) =>
            setCategoryId(event.target.value)
          }
          className="packam-input"
          disabled={loading}
        >
          <option value="">
            Select a category
          </option>

          {categories.map((category) => (
            <option
              key={category.id}
              value={category.id}
            >
              {category.name}
            </option>
          ))}
        </select>
      </div>

      {/* PRICE */}
      <div>
        <label
          htmlFor="price"
          className="mb-2 block text-sm font-black"
        >
          Customer price (₦)
        </label>

        <input
          id="price"
          type="number"
          min="0"
          step="1"
          value={customerPrice}
          onChange={(event) =>
            setCustomerPrice(event.target.value)
          }
          placeholder="e.g. 1500"
          className="packam-input"
          disabled={loading}
        />

        <p className="mt-2 text-xs text-black/40">
          This is the price the student will see and pay.
        </p>
      </div>

      {/* DESCRIPTION */}
      <div>
        <label
          htmlFor="description"
          className="mb-2 block text-sm font-black"
        >
          Description
          <span className="ml-2 font-medium text-black/40">
            Optional
          </span>
        </label>

        <textarea
          id="description"
          value={description}
          onChange={(event) =>
            setDescription(event.target.value)
          }
          placeholder="Briefly describe the product..."
          rows={4}
          className="packam-input resize-none"
          disabled={loading}
        />
      </div>

      {/* PRODUCT IMAGE */}
      <div>
        <label className="mb-3 block text-sm font-black">
          Product image
        </label>

        <ProductImageUpload
          value={imageUrl}
          onChange={setImageUrl}
        />

        <p className="mt-2 text-xs text-black/40">
          Add a clear image of the actual product students
          will receive.
        </p>
      </div>

      {/* STATUS */}
      <div>
        <label
          htmlFor="status"
          className="mb-2 block text-sm font-black"
        >
          Product status
        </label>

        <select
          id="status"
          value={status}
          onChange={(event) =>
            setStatus(
              event.target.value as
                | "ACTIVE"
                | "INACTIVE",
            )
          }
          className="packam-input"
          disabled={loading}
        >
          <option value="ACTIVE">
            Active — visible to students
          </option>

          <option value="INACTIVE">
            Inactive — hidden from students
          </option>
        </select>
      </div>

      {/* ACTIONS */}
      <div className="flex flex-col gap-3 border-t border-black/5 pt-6 sm:flex-row">
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-black px-7 py-3.5 text-sm font-black text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? isEditing
              ? "Saving..."
              : "Adding..."
            : isEditing
              ? "Save Changes"
              : "Add Product"}
        </button>

        <button
          type="button"
          onClick={() => router.back()}
          disabled={loading}
          className="rounded-full border border-black/10 bg-white px-7 py-3.5 text-sm font-black transition hover:border-black/20 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
