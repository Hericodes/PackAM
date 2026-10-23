import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the marketplace page has no delivery-fee sentence under the heading", () => {
  const page = source("./search/page.tsx");
  assert.doesNotMatch(page, /Prices include everything|added once per order|except the flat/);
});

test("the homepage greets students in the PackAM voice", () => {
  const page = source("./page.tsx");
  assert.match(page, /Wetin dey sup\?/);
  assert.doesNotMatch(page, /What brings you here today\?/);
});

test("admin data tables stack into labelled cards on phones: every cell has a label", () => {
  for (const path of ["./admin/payments/page.tsx", "./admin/finance/page.tsx", "../components/admin/AdminCategories.tsx"]) {
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
  assert.match(source("./admin/layout.tsx"), /className="pk-ops-main"/, "admin pages get phone-friendly wrapping and tap targets");
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
