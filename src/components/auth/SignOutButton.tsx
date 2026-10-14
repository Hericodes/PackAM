"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => { setBusy(true); void signOut({ redirectTo: "/login" }); }}
      className="min-h-11 rounded-full px-3 text-sm font-bold text-black/70 transition hover:bg-black/5 hover:text-black"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
