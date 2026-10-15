import Link from "next/link";

type Action = { href: string; label: string; variant?: "primary" | "secondary" };

export function EmptyState({ icon, title, body, actions = [] }: { icon: string; title: string; body: string; actions?: Action[] }) {
  return (
    <div className="pk-empty">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#fff4c7] text-2xl" aria-hidden="true">{icon}</span>
      <h2 className="mt-4 text-lg font-black">{title}</h2>
      <p className="pk-muted mt-1 max-w-sm text-sm leading-6">{body}</p>
      {actions.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {actions.map((action) => (
            <Link key={action.href} href={action.href} className={`pk-btn ${action.variant === "secondary" ? "pk-btn-secondary" : "pk-btn-primary"}`}>
              {action.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
