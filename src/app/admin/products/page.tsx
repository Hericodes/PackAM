import Image from "next/image";
import Link from "next/link";
import { requireRole } from "../../../lib/auth-guard";
import { db } from "../../../lib/db";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { ProductRowActions } from "../../../components/admin/ProductRowActions";
import { activationBlocker, isPriceSet } from "../../../lib/catalogue-permissions";
import { productImageDeliveryUrl } from "../../../lib/cloudinary-url";
import { Icon } from "../../../components/ui/Icon";
import {
  ADMIN_PRODUCT_ORDER_BY,
  ADMIN_PRODUCTS_PAGE_SIZE,
  adminProductsHref,
  adminProductWhere,
  parseAdminProductFilters,
  productDeletionBlocker,
  STOCK_LABELS,
  stockState,
} from "../../../lib/products/admin-catalogue";

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const filters = parseAdminProductFilters(await searchParams);
  const where = adminProductWhere(filters);
  const pageSize = ADMIN_PRODUCTS_PAGE_SIZE;

  const [products, total, activeCount, inactiveCount, categories] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: ADMIN_PRODUCT_ORDER_BY,
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, name: true, description: true, customerPrice: true, status: true, imageUrl: true, updatedAt: true,
        category: { select: { name: true } },
        _count: { select: { orderItems: true } },
        sources: { select: { availability: true } },
      },
    }),
    db.product.count({ where }),
    db.product.count({ where: { status: "ACTIVE" } }),
    db.product.count({ where: { status: "INACTIVE" } }),
    db.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = Boolean(filters.q || filters.categoryId || filters.status || filters.stock || filters.photo);
  const firstInactiveIndex = products.findIndex((product) => product.status === "INACTIVE");

  return (
    <main className="min-h-screen">
      <div className="packam-container py-8 sm:py-10">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.15em] text-black/40">Catalogue</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Products</h1>
            <p className="mt-2 text-sm text-black/55">Active products are listed first. Students only see active products.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/categories" className="inline-flex min-h-11 items-center rounded-full border border-black/10 bg-white px-5 text-sm font-bold">Manage categories</Link>
            <Link href="/admin/products/import" className="inline-flex min-h-11 items-center rounded-full border border-black/10 bg-white px-5 text-sm font-bold">Bulk import products</Link>
            <Link href="/admin/products/new" className="inline-flex min-h-11 items-center rounded-full bg-black px-6 text-sm font-black text-white transition hover:bg-black/85">+ Add product</Link>
          </div>
        </div>

        <dl className="mt-6 flex flex-wrap gap-2 text-sm">
          <div className="rounded-full bg-white px-4 py-2"><dt className="inline font-semibold text-black/55">Active </dt><dd className="inline font-black">{activeCount}</dd></div>
          <div className="rounded-full bg-white px-4 py-2"><dt className="inline font-semibold text-black/55">Inactive </dt><dd className="inline font-black">{inactiveCount}</dd></div>
          {filtered && <div className="rounded-full bg-[#fff4c7] px-4 py-2"><dt className="inline font-semibold text-black/60">Matching filters </dt><dd className="inline font-black">{total}</dd></div>}
        </dl>

        <form action="/admin/products" role="search" className="mt-4 grid gap-2 rounded-2xl bg-white p-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_150px_160px_150px_auto]">
          <label className="sr-only" htmlFor="product-search">Search products by name</label>
          <input id="product-search" name="q" type="search" defaultValue={filters.q} placeholder="Search by product name" className="pk-input min-h-11" />
          <label className="sr-only" htmlFor="product-category">Category</label>
          <select id="product-category" name="category" defaultValue={filters.categoryId} className="pk-input min-h-11">
            <option value="">All categories</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="product-status">Status</label>
          <select id="product-status" name="status" defaultValue={filters.status} className="pk-input min-h-11">
            <option value="">Active & inactive</option>
            <option value="ACTIVE">Active only</option>
            <option value="INACTIVE">Inactive only</option>
          </select>
          <label className="sr-only" htmlFor="product-stock">Stock</label>
          <select id="product-stock" name="stock" defaultValue={filters.stock} className="pk-input min-h-11">
            <option value="">Any stock</option>
            <option value="IN_STOCK">In stock</option>
            <option value="OUT_OF_STOCK">Out of stock</option>
            <option value="UNCHECKED">Stock not checked</option>
          </select>
          <label className="sr-only" htmlFor="product-photo">Photo</label>
          <select id="product-photo" name="photo" defaultValue={filters.photo} className="pk-input min-h-11">
            <option value="">Any photo</option>
            <option value="missing">Needs a photo</option>
          </select>
          <div className="flex gap-2">
            <button type="submit" className="pk-btn pk-btn-primary flex-1 sm:flex-none">Apply</button>
            {filtered && <Link href="/admin/products" className="pk-btn pk-btn-secondary flex-1 sm:flex-none">Clear</Link>}
          </div>
        </form>

        <section aria-label="Products" className="mt-5 overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm">
          {products.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <div className="text-5xl" aria-hidden="true">📦</div>
              <h2 className="mt-4 text-xl font-black">{filtered ? "No products match these filters" : "No products yet"}</h2>
              <p className="mt-2 text-sm text-black/55">{filtered ? "Try another name or clear the filters." : "The shelves are empty o. Add the first product to the PackAM marketplace."}</p>
              <Link href={filtered ? "/admin/products" : "/admin/products/new"} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-black px-6 text-sm font-black text-white">{filtered ? "Clear filters" : "Add product"}</Link>
            </div>
          ) : (
            <ul className="divide-y divide-black/5">
              {products.map((product, index) => {
                const blocker = productDeletionBlocker({ status: product.status, orderItems: product._count.orderItems, openCheckouts: 0 });
                const stock = stockState(product.sources.map((source) => source.availability));
                return (
                  <li key={product.id} className={product.status === "INACTIVE" ? "bg-black/[0.015]" : undefined}>
                    {index === firstInactiveIndex && (
                      <p className="border-b border-black/5 bg-[#f7f5ee] px-5 py-2 text-xs font-black uppercase tracking-wider text-black/50">
                        Inactive products — hidden from students
                      </p>
                    )}
                    <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 sm:px-5 lg:grid-cols-[56px_minmax(0,1.6fr)_minmax(0,1fr)_110px_auto] lg:items-center">
                      <div className="relative row-span-3 h-14 w-14 overflow-hidden rounded-xl border border-black/5 bg-[#f7f5ee] lg:row-span-1">
                        {product.imageUrl
                          ? <Image src={productImageDeliveryUrl(product.imageUrl)} alt="" fill sizes="56px" className="object-contain" />
                          : <span className="flex h-full items-center justify-center text-black/30" title="No photo"><Icon name="image" className="h-6 w-6" /></span>}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className={`font-black ${product.status === "INACTIVE" ? "text-black/60" : ""}`}>{product.name}</p>
                          <StatusBadge label={product.status === "ACTIVE" ? "Active" : "Inactive"} tone={product.status === "ACTIVE" ? "success" : "neutral"} />
                          {!product.imageUrl && <StatusBadge label="No photo" tone="warning" />}
                          {!isPriceSet(product.customerPrice) && <StatusBadge label="Price not set" tone="danger" />}
                          <StatusBadge label={STOCK_LABELS[stock]} tone={stock === "IN_STOCK" ? "success" : stock === "OUT_OF_STOCK" ? "danger" : "neutral"} />
                        </div>
                        {product.description && <p className="mt-1 truncate text-xs text-black/45">{product.description}</p>}
                        <p className="mt-1 text-xs text-black/45">
                          {product._count.orderItems ? `In ${product._count.orderItems} order ${product._count.orderItems === 1 ? "item" : "items"}` : "Never ordered"}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-black/60"><span className="text-black/40 lg:hidden">Category: </span>{product.category.name}</p>
                      <p className="text-sm font-black">{isPriceSet(product.customerPrice) ? `₦${product.customerPrice.toLocaleString()}` : <span className="font-semibold text-black/45">Not set</span>}</p>
                      <div className="col-span-2 lg:col-span-1"><ProductRowActions product={{ id: product.id, name: product.name, status: product.status }} deleteBlockedReason={blocker} activationBlockedReason={product.status === "INACTIVE" ? activationBlocker(product.customerPrice) : null} /></div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {total > 0 && (
          <nav aria-label="Product pages" className="mt-4 flex items-center justify-between gap-3 text-sm">
            {filters.page > 1 ? <Link href={adminProductsHref({ ...filters, page: filters.page - 1 })} className="inline-flex min-h-11 items-center font-bold underline">← Previous</Link> : <span />}
            <span className="text-black/55">{total} {total === 1 ? "product" : "products"} · Page {filters.page} of {pages}</span>
            {filters.page < pages ? <Link href={adminProductsHref({ ...filters, page: filters.page + 1 })} className="inline-flex min-h-11 items-center font-bold underline">Next →</Link> : <span />}
          </nav>
        )}
      </div>
    </main>
  );
}
