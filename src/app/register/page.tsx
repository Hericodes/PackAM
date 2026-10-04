"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });

  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function updateField(
    field: keyof typeof form,
    value: string
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");

    if (form.password !== form.confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }

    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          password: form.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Unable to create your account.");
        return;
      }

      router.push("/login?registered=true");
    } catch {
      setError(
        "We couldn't create your account. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#fffdf7] px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[85vh] max-w-md flex-col justify-center">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center text-2xl font-black tracking-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
          >
            Pack<span className="text-yellow-600">AM</span>
          </Link>

          <h1 className="mt-6 text-3xl font-black tracking-tight sm:mt-8 sm:text-4xl">
            Create your account.
          </h1>

          <p className="mt-2 text-sm leading-6 text-black/70 sm:text-base">
            Join PackAM and get what you need without leaving
            where you are.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-3xl border border-black/5 bg-white/70 p-4 shadow-sm sm:p-6"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="firstName"
                className="mb-2 block text-sm font-semibold"
              >
                First name
              </label>

              <input
                id="firstName"
                type="text"
                value={form.firstName}
                onChange={(event) =>
                  updateField("firstName", event.target.value)
                }
                placeholder="Olayimika"
                autoComplete="given-name"
                required
                className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-black/45 focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black/20"
              />
            </div>

            <div>
              <label
                htmlFor="lastName"
                className="mb-2 block text-sm font-semibold"
              >
                Last name
              </label>

              <input
                id="lastName"
                type="text"
                value={form.lastName}
                onChange={(event) =>
                  updateField("lastName", event.target.value)
                }
                placeholder="Ogunmona"
                autoComplete="family-name"
                required
                className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-black/45 focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black/20"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-semibold"
            >
              Email
            </label>

            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(event) =>
                updateField("email", event.target.value)
              }
              placeholder="you@example.com"
              autoComplete="email"
              required
              className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-black/45 focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black/20"
            />
          </div>

          <div>
            <label
              htmlFor="phone"
              className="mb-2 block text-sm font-semibold"
            >
              Phone number
            </label>

            <input
              id="phone"
              type="tel"
              value={form.phone}
              onChange={(event) =>
                updateField("phone", event.target.value)
              }
              placeholder="08012345678"
              autoComplete="tel"
              required
              className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-black/45 focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black/20"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-semibold"
            >
              Password
            </label>

            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(event) =>
                updateField("password", event.target.value)
              }
              placeholder="At least 8 characters"
              autoComplete="new-password"
              required
              className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-black/45 focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black/20"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-2 block text-sm font-semibold"
            >
              Confirm password
            </label>

            <input
              id="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={(event) =>
                updateField(
                  "confirmPassword",
                  event.target.value
                )
              }
              placeholder="Enter your password again"
              autoComplete="new-password"
              required
              className="w-full rounded-2xl border border-black/15 bg-white px-4 py-3.5 text-base outline-none transition placeholder:text-black/45 focus-visible:border-black focus-visible:ring-2 focus-visible:ring-black/20"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium leading-6 text-red-800">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="min-h-12 w-full rounded-2xl bg-black px-5 py-3.5 text-base font-bold text-white transition hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading
              ? "Creating your account..."
              : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm leading-6 text-black/70">
          Already have an account?{" "}
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center font-bold text-black underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}