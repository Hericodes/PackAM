import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-[#fffdf7] px-4 py-16">
      <div className="max-w-md text-center">
        <p className="text-5xl" aria-hidden="true">🧭</p>
        <h1 className="mt-4 text-2xl font-black sm:text-3xl">We no fit find this page</h1>
        <p className="mt-3 text-sm leading-6 text-black/70">It may have moved, or the link is from an account you’re not signed in to.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/" className="inline-flex min-h-12 items-center rounded-full bg-black px-6 text-sm font-black text-white transition hover:bg-black/85">Go home</Link>
          <Link href="/search" className="inline-flex min-h-12 items-center rounded-full border border-black/15 px-6 text-sm font-black transition hover:bg-black/5">Search PackAM</Link>
        </div>
      </div>
    </main>
  );
}
