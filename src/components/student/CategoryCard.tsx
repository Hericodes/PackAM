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
      href={`/search?category=${slug}`}
      className="group min-w-[150px] rounded-3xl border border-black/5 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff4c7] text-2xl">
        {emoji}
      </div>

      <p className="mt-4 text-sm font-black leading-5">
        {name}
      </p>
    </Link>
  );
}