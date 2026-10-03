import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="min-h-screen bg-[#fffdf7] px-6 py-10">
      <div className="mx-auto flex min-h-[90vh] max-w-md flex-col items-center justify-center text-center">
        <div className="mb-6 text-6xl">🚫</div>

        <h1 className="text-3xl font-black tracking-tight">
          Hmm... not your side of PackAM.
        </h1>

        <p className="mt-3 text-sm leading-6 text-black/60">
          You don&apos;t have permission to access this area.
        </p>

        <Link
          href="/"
          className="mt-8 rounded-2xl bg-black px-6 py-3 font-bold text-white transition hover:bg-black/85"
        >
          Back to PackAM
        </Link>
      </div>
    </main>
  );
}