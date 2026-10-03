import Link from "next/link";
import { db } from "../../../../lib/db";

export default async function RunnerProductsPage() {
  const products = await db.product.findMany({
    include: {
      category: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <main className="min-h-screen bg-[#fffdf7]">
      <div className="packam-container py-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.15em] text-black/40">
              Runner
            </p>

            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Products
            </h1>

            <p className="mt-2 text-sm text-black/50">
              Manage products available on the PackAM marketplace.
            </p>
          </div>

          <Link
            href="/runner/products/new"
            className="inline-flex w-fit rounded-full bg-black px-6 py-3 text-sm font-black text-white transition hover:bg-black/85"
          >
            + Add Product
          </Link>
        </div>

        <div className="mt-10 overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm">
          {products.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="text-5xl">📦</div>

              <h2 className="mt-4 text-xl font-black">
                No products yet
              </h2>

              <p className="mt-2 text-sm text-black/50">
                Add your first product to the marketplace.
              </p>

              <Link
                href="/runner/products/new"
                className="mt-6 inline-flex rounded-full bg-black px-6 py-3 text-sm font-black text-white"
              >
                Add Product
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead className="border-b border-black/5 bg-[#f7f5ee]">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-wide text-black/40">
                      Product
                    </th>

                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-wide text-black/40">
                      Category
                    </th>

                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-wide text-black/40">
                      Price
                    </th>

                    <th className="px-6 py-4 text-left text-xs font-black uppercase tracking-wide text-black/40">
                      Status
                    </th>

                    <th className="px-6 py-4 text-right text-xs font-black uppercase tracking-wide text-black/40">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-black/5">
                  {products.map((product) => (
                    <tr
                      key={product.id}
                      className="transition hover:bg-black/[0.015]"
                    >
                      <td className="px-6 py-5">
                        <p className="font-black">
                          {product.name}
                        </p>

                        {product.description && (
                          <p className="mt-1 max-w-xs truncate text-xs text-black/40">
                            {product.description}
                          </p>
                        )}
                      </td>

                      <td className="px-6 py-5 text-sm font-semibold text-black/60">
                        {product.category.name}
                      </td>

                      <td className="px-6 py-5 text-sm font-black">
                        ₦{product.customerPrice.toLocaleString()}
                      </td>

                      <td className="px-6 py-5">
                        {product.status === "ACTIVE" ? (
                          <span className="inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-black text-green-700">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-black/5 px-3 py-1 text-xs font-black text-black/50">
                            Inactive
                          </span>
                        )}
                      </td>

                      <td className="px-6 py-5 text-right">
                        <Link
                          href={`/runner/products/${product.id}/edit`}
                          className="rounded-full border border-black/10 px-4 py-2 text-xs font-black transition hover:border-black/20 hover:bg-black/[0.02]"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}