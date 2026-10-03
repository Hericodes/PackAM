import Link from "next/link";
import { PaymentResultClient } from "../../../../components/checkout/PaymentResultClient";

export default async function PaymentResultPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference } = await searchParams;
  return (
    <main className="min-h-screen bg-[#fffdf7] px-4 py-16">
      <section className="mx-auto max-w-lg rounded-[1.5rem] border border-black/5 bg-white p-6 text-center sm:p-10">
        {reference ? <PaymentResultClient reference={reference} /> : (
          <>
            <h1 className="text-2xl font-black">Payment reference missing</h1>
            <p className="mt-3 text-sm text-black/60">Open your checkout to start a payment.</p>
            <Link href="/checkout" className="mt-6 inline-flex rounded-full bg-black px-6 py-3 text-sm font-black text-white">Back to checkout</Link>
          </>
        )}
      </section>
    </main>
  );
}
