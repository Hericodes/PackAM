import { requireRole } from "../../../lib/auth-guard";
import { ProductRequestList } from "../../../components/student/ProductRequestList";

type ProductRequestsPageProps = { searchParams: Promise<{ name?: string }> };

export default async function ProductRequestsPage({ searchParams }: ProductRequestsPageProps) {
  await requireRole("STUDENT", "/product-requests");
  const params = await searchParams;
  const initialProductName = (params.name ?? "").trim().slice(0, 120);
  return (
    <main className="min-h-screen">
      <div className="packam-container py-8 sm:py-10">
        <header className="mb-6 sm:mb-8">
          <p className="pk-eyebrow">Can’t find it?</p>
          <h1 className="pk-page-title mt-2">Request an item</h1>
          <p className="pk-muted mt-2 max-w-xl text-sm leading-6 sm:text-base">
            Tell us what you need. We check campus shops and update you here — nothing is charged until it’s in the catalogue and you order it.
          </p>
          <ol className="mt-4 flex flex-wrap gap-2 text-xs font-bold" aria-label="How requests work">
            <li className="pk-pill pk-pill-neutral">1 · You request</li>
            <li className="pk-pill pk-pill-neutral">2 · We check shops</li>
            <li className="pk-pill pk-pill-neutral">3 · You get notified</li>
          </ol>
        </header>
        <ProductRequestList initialProductName={initialProductName} />
      </div>
    </main>
  );
}
