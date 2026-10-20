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
