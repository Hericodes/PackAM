import { requireRole } from "../../../lib/auth-guard";
import { ProductRequestList } from "../../../components/student/ProductRequestList";

type ProductRequestsPageProps = { searchParams: Promise<{ name?: string }> };

export default async function ProductRequestsPage({ searchParams }: ProductRequestsPageProps) {
  await requireRole("STUDENT", "/product-requests");
  const params = await searchParams;
  const initialProductName = (params.name ?? "").trim().slice(0, 120);
  return (
    <main className="min-h-screen bg-[#fffdf7]">
      <div className="packam-container py-8 sm:py-10">
        <header className="mb-6 sm:mb-8">
          <p className="text-xs font-bold uppercase tracking-wider text-black/50">Can’t find it?</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">Product requests</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-black/65 sm:text-base">
            Tell us what you need and we’ll check around. You can follow the status of your requests here.
          </p>
        </header>
        <ProductRequestList initialProductName={initialProductName} />
      </div>
    </main>
  );
}
