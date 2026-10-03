import { requireRole } from "../../../lib/auth-guard";
import { ProductRequestList } from "../../../components/student/ProductRequestList";

type ProductRequestsPageProps = { searchParams: Promise<{ name?: string }> };

export default async function ProductRequestsPage({ searchParams }: ProductRequestsPageProps) {
  await requireRole("STUDENT", "/product-requests");
  const params = await searchParams;
  const initialProductName = (params.name ?? "").trim().slice(0, 120);
  return <main className="min-h-screen bg-[#fffdf7]"><div className="packam-container py-10"><h1 className="text-3xl font-black">Product requests</h1><ProductRequestList initialProductName={initialProductName} /></div></main>;
}
