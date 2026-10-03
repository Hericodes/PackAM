"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export function LoginForm({ registered, callbackUrl }: { registered: boolean; callbackUrl?: string }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const result = await signIn("credentials", { identifier, password, redirect: false });
      if (!result || result.error) {
        setError("Invalid email/phone or password.");
        return;
      }

      const params = new URLSearchParams();
      if (callbackUrl) params.set("callbackUrl", callbackUrl);
      const response = await fetch(`/api/login-destination${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || typeof data.destination !== "string") throw new Error("Unable to continue to your PackAM page.");
      router.replace(data.destination);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return <main className="min-h-screen bg-[#fffdf7] px-6 py-10">
    <div className="mx-auto flex min-h-[90vh] max-w-md flex-col justify-center">
      <div className="mb-8">
        <Link href="/" className="text-2xl font-black tracking-tight">Pack<span className="text-yellow-500">AM</span></Link>
        <h1 className="mt-8 text-3xl font-black tracking-tight">Welcome back.</h1>
        <p className="mt-2 text-sm leading-6 text-black/60">Log in and let PackAM handle the moving around.</p>
      </div>

      {registered && <div className="mb-5 rounded-2xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">Account created successfully. You can now log in.</div>}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div><label htmlFor="identifier" className="mb-2 block text-sm font-semibold">Email or phone number</label><input id="identifier" type="text" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="you@example.com or 08012345678" autoComplete="username" required className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 outline-none transition focus:border-black" /></div>
        <div><label htmlFor="password" className="mb-2 block text-sm font-semibold">Password</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" autoComplete="current-password" required className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 outline-none transition focus:border-black" /></div>
        {error && <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
        <button type="submit" disabled={isLoading} className="w-full rounded-2xl bg-black px-5 py-3.5 font-bold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50">{isLoading ? "Logging you in..." : "Log in"}</button>
      </form>

      <p className="mt-6 text-center text-sm text-black/60">Don&apos;t have an account? <Link href="/register" className="font-bold text-black underline underline-offset-4">Create one</Link></p>
    </div>
  </main>;
}
