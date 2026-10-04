import Link from "next/link";
import { PaymentResultClient } from "../../../../components/checkout/PaymentResultClient";

export default async function PaymentResultPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string }>;
}) {
  const { reference } = await searchParams;
  return (
    <main className="flex min-h-[calc(100svh-4rem)] items-center bg-[#fffdf7] px-4 py-8 sm:py-12">
      <section className="mx-auto w-full max-w-lg rounded-[1.5rem] border border-black/5 bg-white px-5 py-8 text-center shadow-sm sm:rounded-[2rem] sm:px-10 sm:py-12">
        {reference ? <PaymentResultClient reference={reference} /> : (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fff4c7] text-2xl font-black" aria-hidden="true">!</div>
            <h1 className="mt-5 text-2xl font-black sm:text-3xl">Payment reference missing</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-black/60">Open your checkout to start a payment.</p>
            <Link href="/checkout" className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-black px-6 py-3 text-sm font-black text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black sm:w-auto">Back to checkout</Link>
          </>
        )}
      </section>
    </main>
  );
}
