import Link from "next/link";

type CategoryCardProps = {
  name: string;
  slug: string;
  emoji: string;
};

export function CategoryCard({
  name,
  slug,
  emoji,
}: CategoryCardProps) {
  return (
    <Link
      href={slug === "printing" ? "/printing" : `/search?category=${slug}`}
      className="group min-h-36 min-w-[140px] rounded-3xl border border-black/5 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black sm:min-h-40 sm:min-w-[160px] sm:p-5"
    >
      <div aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff4c7] text-2xl">
        {emoji}
      </div>

      <p className="mt-3 text-base font-black leading-5 sm:mt-4">
        {name}
      </p>
    </Link>
  );
}