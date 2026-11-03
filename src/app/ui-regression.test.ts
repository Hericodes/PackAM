import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the marketplace page has no delivery-fee sentence under the heading", () => {
  const page = source("./search/page.tsx");
  assert.doesNotMatch(page, /Prices include everything|added once per order|except the flat/);
});

test("the homepage greets students in the PackAM voice, a different Pidgin greeting each visit", () => {
  const page = source("./page.tsx");
  assert.match(page, /pickHomeGreeting\(/);
  assert.match(page, /RememberGreeting/);
  assert.match(source("../lib/home-greetings.ts"), /Wetin dey sup\?/);
  assert.doesNotMatch(page, /What brings you here today\?/);
});

test("admin data tables stack into labelled cards on phones: every cell has a label", () => {
  // Categories moved to a card layout (one card per category), which needs no table stacking.
  for (const path of ["./admin/payments/page.tsx", "./admin/finance/page.tsx"]) {
    const file = source(path);
    const tables = file.split("<table").slice(1).map((chunk) => chunk.slice(0, chunk.indexOf("</table>")));
    assert.ok(tables.length > 0, path);
    for (const table of tables) {
      assert.match(table, /pk-stack-table/, `${path}: table uses the stacking layout`);
      const cells = table.match(/<td\b[^>]*>/g) ?? [];
      assert.ok(cells.length > 0, path);
      for (const cell of cells) assert.match(cell, /data-label="[^"]+"/, `${path}: ${cell.slice(0, 60)}`);
    }
  }
  // The admin layout renders every page inside AdminShell, which applies the wrapper.
  assert.match(source("./admin/layout.tsx"), /<AdminShell /, "admin pages use the admin shell");
  assert.match(source("../components/admin/AdminShell.tsx"), /className="pk-ops-main"/, "admin pages get phone-friendly wrapping and tap targets");
});

test("PackAM is always light: the page declares it, and nothing reacts to a dark device setting", async () => {
  assert.match(source("./layout.tsx"), /colorScheme: "only light"/, "opts out of browser auto-dark modes too");
  const css = source("./globals.css");
  assert.match(css, /:root\s*\{[^}]*color-scheme:\s*only light/, "native controls, scrollbars and autofill stay light");
  assert.doesNotMatch(css, /prefers-color-scheme:\s*dark/);
  const { readdirSync } = await import("node:fs");
  const files = (readdirSync(new URL("..", import.meta.url), { recursive: true }) as string[]).filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"));
  for (const file of files) assert.doesNotMatch(source(`../${file.replaceAll("\\", "/")}`), /\bdark:[a-z[]/, `${file} has no dark-mode variants`);
});

test("every phone gets the same font and safe-area handling", () => {
  const layout = source("./layout.tsx");
  assert.match(layout, /viewportFit: "cover"/, "without it, env(safe-area-inset-*) is always 0 on iPhones");
  assert.match(layout, /variable: "--font-packam"/);
  const css = source("./globals.css");
  assert.match(css, /font-family:\s*var\(--font-packam\),\s*Arial/, "one self-hosted font first, the old stack only as a fallback");
  assert.match(css, /\.packam-container\s*\{[^}]*safe-area-inset-left/);
});

test("signup name fields use neutral placeholders, never a real person's name", () => {
  // The page is a server component now (for its title and the signed-in redirect); the fields live in RegisterForm.
  const page = source("./register/page.tsx");
  const form = source("../components/auth/RegisterForm.tsx");
  assert.match(page, /export const metadata/, "the sign-up tab has its own title");
  assert.match(page, /<RegisterForm /);
  assert.match(form, /placeholder="Enter your first name"/);
  assert.match(form, /placeholder="Enter your last name"/);
  for (const file of [page, form]) assert.doesNotMatch(file, /Olayimika|Ogunmona/i);
  assert.match(form, /firstName: "",\s*lastName: "",/, "fields still start empty: no prefill was added or removed");
});

test("pages that receive emailed tokens keep them private: no Referer, no index, no cache, and the address bar is cleaned", () => {
  const tokenPaths = source("../../next.config.ts").match(/\.\.\.\[([^\]]+)\]\.map\(\(source\)/)?.[1] ?? "";
  for (const path of ["/reset-password", "/verify-email", "/confirm-email", "/api/account/verify-email", "/api/account/email/confirm"]) {
    assert.ok(tokenPaths.includes(`"${path}"`), `${path} gets the no-referrer, noindex, no-store headers`);
  }
  assert.match(source("./confirm-email/page.tsx"), /referrer: "no-referrer"/);
  assert.match(source("../components/account/ConfirmEmailForm.tsx"), /searchParams\.delete\("token"\);\s*window\.history\.replaceState/);
});

test("signing in checks PackAM can be reached first, so an offline submit never lands on /api/auth/error", () => {
  for (const path of ["../components/auth/LoginForm.tsx", "../components/auth/RegisterForm.tsx", "../components/account/sign-in-again.ts"]) {
    const file = source(path);
    const check = file.indexOf("await canSignIn()");
    const signIn = file.indexOf("signIn(\"credentials\"");
    assert.ok(check > 0 && signIn > check, `${path}: canSignIn() runs before signIn()`);
  }
});

test("checkout sends only the chosen speed and what the student reviewed, and never switches the speed itself", () => {
  const client = source("../components/checkout/CheckoutClient.tsx");
  // The server prices the speed; the browser never sends a fee, amount or total to charge.
  assert.ok(client.includes("body: JSON.stringify({ deliveryLocationId: selectedLocation.id, deliveryInstructions, deliveryTier: selectedTier, reviewedTotal, reviewedDeliveryFee })"), "the payment request body");
  for (const text of ["deliveryTier: selectedTier", "reviewedDeliveryFee", "paymentAttemptStorageKey(", '"DELIVERY_TIER_UNAVAILABLE"', '"CHECKOUT_CHANGED"', '"INVALID_DELIVERY_TIER"', "handlePayment(confirmed, confirmedFee)"]) {
    assert.ok(client.includes(text), text);
  }
  assert.equal(client.split("setSelectedTier(").length - 1, 1, "only the student's own choice sets the speed");
  assert.doesNotMatch(client, /packam-payment-attempt:/, "the attempt key comes from paymentAttemptStorageKey, which covers the speed and fee");
  assert.ok(client.indexOf('focusStep("checkout-speed")') > 0, "speed problems take the student to the speed step");
  // Client components get prices from props, never from the server-only store, the database or the Prisma runtime.
  for (const path of ["../components/checkout/CheckoutClient.tsx", "../components/checkout/DeliveryTierSelector.tsx", "../components/food/FoodMenu.tsx"]) {
    const file = source(path);
    assert.match(file, /^"use client";/, path);
    assert.doesNotMatch(file, /delivery-tier-store|lib\/db"|from "@prisma\/client"|server-only/, path);
  }
  const page = source("./(student)/checkout/page.tsx");
  assert.match(page, /readDeliveryTierQuotes\(db\)/);
  assert.match(page, /tiers=\{tierQuotes\.quotes\}/);
  assert.doesNotMatch(page, /cart\.deliveryFee|deliveryFee=/, "delivery fees come from the speed quotes, not the cart");
});

test("delivery prices outside checkout come from the speeds on sale, never the old flat fee", () => {
  assert.doesNotMatch(source("./(student)/products/[id]/page.tsx"), /flat per order|STUDENT_DELIVERY_FEE/);
  assert.doesNotMatch(source("../lib/products/catalogue.ts"), /STUDENT_DELIVERY_FEE/);
  for (const path of ["./food/page.tsx", "./food/[shop]/page.tsx", "../components/food/FoodMenu.tsx", "./(student)/checkout/page.tsx", "../lib/cart-pricing.ts", "./(student)/products/[id]/page.tsx"]) {
    assert.doesNotMatch(source(path), /CHECKOUT_DELIVERY_FEE/, path);
  }
  for (const path of ["./food/page.tsx", "./food/[shop]/page.tsx", "./(student)/products/[id]/page.tsx"]) {
    const page = source(path);
    assert.match(page, /readDeliveryTierQuotes\(db\)/, path);
    assert.match(page, /deliveryPriceSummary\(/, path);
  }
  // The legacy ₦200 is Cruise Mode's price only while the delivery-tier tables don't exist yet (fallbackQuoteSet).
  const files = (readdirSync(new URL("..", import.meta.url), { recursive: true }) as string[])
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts") && !file.endsWith(".db-test.ts"));
  assert.ok(files.length > 100, `scanned ${files.length} files`);
  assert.deepEqual(files.filter((file) => source(`../${file}`).includes("CHECKOUT_DELIVERY_FEE")).sort(), ["lib/checkout-pricing.ts", "lib/delivery-tiers.ts"]);
});

test("the homepage offers Order Stuff, Food and Printing, in that order, and no Student Verification", () => {
  const page = source("./page.tsx");
  const order = [/id: "order"[^}]*href: "\/search"/, /id: "food"[^}]*href: "\/food"/, /id: "printing"[^}]*href: "\/printing"/].map((pattern) => page.search(pattern));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), `services in order: ${order}`);
  assert.doesNotMatch(page, /Student Verification/);
});
