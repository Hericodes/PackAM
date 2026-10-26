import assert from "node:assert/strict";
import { test } from "node:test";
import { IMPORT_COLUMNS, IMPORT_MAX_ROWS, assignSlugs, importTemplate, previewImport, type ImportCategory, type ImportPreview } from "./bulk-import";

const categories: ImportCategory[] = [
  { id: "cat-academic", name: "Academic Materials", slug: "academic-materials", isActive: true },
  { id: "cat-food", name: "Food & Drinks", slug: "food-drinks", isActive: true },
  { id: "cat-old", name: "Old Stuff", slug: "old-stuff", isActive: false },
];
const ok = (preview: ImportPreview) => {
  assert.ok(preview.ok, preview.ok ? "" : preview.error);
  return preview;
};
const csv = (...lines: string[]) => ["name,category,price,description,visibility", ...lines].join("\r\n");

test("the template documents every column, has no example products, and is accepted as an empty import", () => {
  const template = importTemplate();
  for (const column of IMPORT_COLUMNS) assert.match(template, new RegExp(`# ${column.key}: `));
  assert.match(template, /Photos are not imported/);
  assert.match(template, /\r\nname,category,price,description,visibility\r\n$/);
  const preview = previewImport(template, categories, []);
  assert.ok(!preview.ok && /header but no products/.test(preview.error), "only the header: nothing invented to import");
});

test("valid rows are ready with the server's own category id, a whole-naira price and hidden by default", () => {
  const preview = ok(previewImport(csv(
    'Blue Ballpoint Pen,Academic Materials,"₦1,500","Blue ink, medium point",',
    "Bottled Water,food-drinks,300,,visible",
  ), categories, []));
  assert.deepEqual(preview.summary, { total: 2, ready: 2, errors: 0, duplicates: 0, existing: 0 });
  assert.deepEqual(preview.rows[0].product, { name: "Blue Ballpoint Pen", categoryId: "cat-academic", categoryName: "Academic Materials", customerPrice: 1500, description: "Blue ink, medium point", status: "INACTIVE" });
  assert.equal(preview.rows[1].product?.status, "ACTIVE", "visible only when the file says so");
  assert.equal(preview.rows[1].product?.categoryId, "cat-food", "slug matches too");
  assert.deepEqual(preview.rows.map((row) => row.row), [2, 3], "spreadsheet row numbers");
});

test("every invalid value is reported on its row with a reason; nothing is guessed", () => {
  const preview = ok(previewImport(csv(
    ",Academic Materials,500,,",
    "Pen,Academic,500,,",
    "Pen 2,Old Stuff,500,,",
    "Pen 3,Academic Materials,,,",
    "Pen 4,Academic Materials,0,,",
    "Pen 5,Academic Materials,-50,,",
    "Pen 6,Academic Materials,12.50,,",
    "Pen 7,Academic Materials,five hundred,,",
    `${"x".repeat(121)},Academic Materials,500,,`,
    "Pen 8,Academic Materials,500,,published",
    "Pen 9,Academic Materials,500,ok,hidden,extra",
  ), categories, []));
  const reasons = preview.rows.map((row) => [row.row, row.outcome, row.errors.join(" ")]);
  const expect = [/Name is empty/, /Category “Academic” doesn’t exist. Use one of: Academic Materials, Food & Drinks\./, /“Old Stuff” is hidden/, /Price is empty/, /at least ₦1/, /isn’t a whole naira amount/, /isn’t a whole naira amount/, /isn’t a whole naira amount/, /Name is 121 characters/, /Visibility “published” isn’t supported/, /6 values but the header has 5 columns/];
  expect.forEach((pattern, index) => {
    assert.equal(reasons[index][1], "error", String(reasons[index]));
    assert.match(String(reasons[index][2]), pattern, `row ${reasons[index][0]}`);
  });
  assert.equal(preview.summary.errors, 11);
  assert.equal(preview.summary.ready, 0);
});

test("duplicates: a repeated name in the file and a product that already exists are skipped, never changed", () => {
  const preview = ok(previewImport(csv(
    "Eraser,Academic Materials,100,,",
    "eraser ,Academic Materials,150,,",
    "Project File,Academic Materials,400,,",
  ), categories, [{ id: "seed-product-file", name: "Project File", category: "Academic Materials", customerPrice: 400, status: "ACTIVE" }]));
  assert.deepEqual(preview.rows.map((row) => row.outcome), ["ready", "duplicate-in-file", "exists"]);
  assert.equal(preview.rows[1].duplicateOfRow, 2);
  assert.equal(preview.rows[2].existing?.id, "seed-product-file");
  assert.equal(preview.rows[2].product, undefined, "nothing to write for an existing product");
  assert.deepEqual(preview.summary, { total: 3, ready: 1, errors: 0, duplicates: 1, existing: 1 });
});

test("columns: any order, header aliases, notes and blank lines skipped, image and stock columns ignored with a warning", () => {
  const preview = ok(previewImport([
    "# notes from the template",
    "Price (₦),Product Name,Category,Image URL,Stock",
    "",
    '700,"Notebook, 60 leaves",Academic Materials,https://example.com/x.jpg,40',
    '400,"Exercise book',
    'with a long description",Academic Materials,,',
    "300,Ruler,Academic Materials,,",
  ].join("\n"), categories, []));
  assert.deepEqual(preview.rows.map((row) => [row.row, row.name, row.product?.customerPrice]), [[4, "Notebook, 60 leaves", 700], [5, "Exercise book\nwith a long description", 400], [6, "Ruler", 300]]);
  assert.ok(preview.rows.every((row) => row.product?.status === "INACTIVE"));
  assert.ok(preview.warnings.some((warning) => /Image URL.*photos are uploaded per product/.test(warning)));
  assert.ok(preview.warnings.some((warning) => /Stock.*doesn’t import it/.test(warning)));
});

test("file-level problems stop the preview with one clear message", () => {
  const error = (text: string) => { const preview = previewImport(text, categories, []); return preview.ok ? "" : preview.error; };
  assert.match(error(""), /empty/);
  assert.match(error("title,cost\nPen,5"), /missing name, category, price/);
  assert.match(error('name,category,price\n"Pen,Academic Materials,5'), /isn’t valid CSV. Line 2/);
  assert.match(error(csv(...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `P${i},Academic Materials,5,,`))), /Import up to 500 at a time/);
  assert.equal(ok(previewImport(csv(...Array.from({ length: IMPORT_MAX_ROWS }, (_, i) => `P${i},Academic Materials,5,,`)), categories, [])).summary.ready, IMPORT_MAX_ROWS);
});

test("slugs never collide with existing ones or each other", () => {
  assert.deepEqual(assignSlugs(["Pen", "Pen!", "Lab Coat", "!!!"], new Set(["pen", "pen-2"])), ["pen-3", "pen-4", "lab-coat", "product"]);
});
