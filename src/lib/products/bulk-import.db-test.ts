/**
 * CSV product import through the real API against a disposable database: preview writes nothing,
 * import is all-or-nothing and admin-only, repeats and races never duplicate, existing products are
 * never changed, and imported products follow the normal storefront rules.
 * Run with `npm run test:db` (see src/test-support/db-harness.ts).
 */
import {
  callRoute,
  cleanupTestData,
  createTestCatalogue,
  createTestUser,
  dbTestSkip as skip,
  runTag,
  signInAs,
  testDb,
} from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

type App = {
  db: Awaited<ReturnType<typeof testDb>>;
  route: typeof import("../../app/api/admin/products/import/route");
  catalogue: typeof import("./catalogue");
};
let app: App;
const importedNames: string[] = [];

before(async () => {
  if (skip) return;
  const db = await testDb();
  const [route, catalogue] = await Promise.all([import("../../app/api/admin/products/import/route"), import("./catalogue")]);
  app = { db, route, catalogue };
});

after(async () => {
  if (!skip && importedNames.length) {
    const products = await app.db.product.findMany({ where: { name: { in: importedNames } }, select: { id: true } });
    await app.db.auditLog.deleteMany({ where: { resourceId: { in: products.map((product) => product.id) } } });
    await app.db.product.deleteMany({ where: { id: { in: products.map((product) => product.id) } } });
  }
  await cleanupTestData();
});

const name = (label: string) => { const value = `${label} ${runTag}`; importedNames.push(value); return value; };
const file = (categoryName: string, rows: string[]) => ["name,category,price,description,visibility", ...rows.map((row) => row.replaceAll("{cat}", categoryName))].join("\r\n");
async function preview(csv: string) {
  const response = await callRoute(app.route.POST, { method: "POST", body: { mode: "preview", csv } });
  return response as { status: number; json: { fileHash: string; summary: Record<string, number>; rows: Array<{ outcome: string }> } & Record<string, unknown> };
}

test("preview writes nothing; import creates exactly the ready rows, hidden by default, with no image", { skip }, async () => {
  const { db, route, catalogue } = app;
  signInAs(await createTestUser("ADMIN"));
  const { categoryId } = await createTestCatalogue([]);
  const category = await db.category.findUniqueOrThrow({ where: { id: categoryId } });
  const [visible, hidden] = [name("Import visible"), name("Import hidden")];
  const csv = file(category.name, [`"${visible}",{cat},"₦1,500","Blue, medium",visible`, `"${hidden}",{cat},700,,`, `"${name("Import bad")}",{cat},0,,`]);

  const checked = await preview(csv);
  assert.equal(checked.status, 200);
  assert.deepEqual(checked.json.summary, { total: 3, ready: 2, errors: 1, duplicates: 0, existing: 0 });
  assert.equal(await db.product.count({ where: { name: { in: [visible, hidden] } } }), 0, "preview wrote nothing");

  const imported = await callRoute(route.POST, { method: "POST", body: { mode: "import", csv, fileHash: checked.json.fileHash } });
  assert.equal(imported.status, 201);
  const rows = await db.product.findMany({ where: { name: { in: [visible, hidden] } }, select: { name: true, status: true, customerPrice: true, imageUrl: true, description: true } });
  assert.deepEqual(rows.sort((a, b) => a.name.localeCompare(b.name)).map((row) => [row.name, row.status, row.customerPrice, row.imageUrl]), [[hidden, "INACTIVE", 700, null], [visible, "ACTIVE", 1500, null]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  assert.equal((imported.json.failed as unknown[]).length, 1);

  const forStudents = await db.product.findMany({ where: { name: { in: [visible, hidden] }, ...catalogue.studentCatalogueProductWhere }, select: { name: true } });
  assert.deepEqual(forStudents.map((row) => row.name), [visible], "only the visible one reaches the storefront");
  assert.equal(await db.auditLog.count({ where: { action: "PRODUCT_CREATED", details: { startsWith: "CSV import" }, resourceId: { in: (await db.product.findMany({ where: { name: { in: [visible, hidden] } }, select: { id: true } })).map((row) => row.id) } } }), 2);
});

test("importing the same file again, or twice at once, never duplicates; existing products are untouched", { skip }, async () => {
  const { db, route } = app;
  signInAs(await createTestUser("ADMIN"));
  const { categoryId, products: [existing] } = await createTestCatalogue([{ name: `Existing ${runTag}`, price: 900 }]);
  const category = await db.category.findUniqueOrThrow({ where: { id: categoryId } });
  const fresh = name("Import once");
  const csv = file(category.name, [`"${fresh}",{cat},300,,`, `"${existing.name.toUpperCase()}",{cat},100,,visible`]);
  const { json } = await preview(csv);
  assert.deepEqual(json.rows.map((row) => row.outcome), ["ready", "exists"]);

  const body = { mode: "import", csv, fileHash: json.fileHash };
  const [a, b] = await Promise.all([callRoute(route.POST, { method: "POST", body }), callRoute(route.POST, { method: "POST", body })]);
  const again = await callRoute(route.POST, { method: "POST", body });
  assert.deepEqual([a.status, b.status].sort(), [200, 201], "one import creates, the racing one finds it already there");
  assert.equal(again.status, 200);
  assert.equal((again.json.created as unknown[]).length, 0);
  assert.equal(await db.product.count({ where: { name: fresh } }), 1);
  const untouched = await db.product.findUniqueOrThrow({ where: { id: existing.id } });
  assert.equal(untouched.customerPrice, 900, "the existing product's price was not overwritten");
});

test("the import must be of the previewed file, and a bad file imports nothing", { skip }, async () => {
  const { db, route } = app;
  signInAs(await createTestUser("ADMIN"));
  const { categoryId } = await createTestCatalogue([]);
  const category = await db.category.findUniqueOrThrow({ where: { id: categoryId } });
  const csv = file(category.name, [`"${name("Import edited")}",{cat},300,,`]);
  const { json } = await preview(csv);
  const edited = await callRoute(route.POST, { method: "POST", body: { mode: "import", csv: `${csv}\r\n"${name("Sneaked in")}",${category.name},5,,`, fileHash: json.fileHash } });
  assert.equal(edited.status, 409);
  assert.equal((await preview('name,category,price\n"broken,x,1')).status, 400);
  assert.equal(await db.product.count({ where: { name: { startsWith: "Sneaked in" } } }), 0);
});

test("students, runners and signed-out visitors can't preview or import", { skip }, async () => {
  const { db, route } = app;
  const { categoryId } = await createTestCatalogue([]);
  const category = await db.category.findUniqueOrThrow({ where: { id: categoryId } });
  const csv = file(category.name, [`"${name("Import forbidden")}",{cat},300,,visible`]);
  for (const user of [null, await createTestUser("STUDENT"), await createTestUser("RUNNER", { isVerified: true, isAvailable: true })]) {
    signInAs(user);
    assert.equal((await callRoute(route.POST, { method: "POST", body: { mode: "preview", csv } })).status, 403);
    assert.equal((await callRoute(route.POST, { method: "POST", body: { mode: "import", csv, fileHash: "0".repeat(64) } })).status, 403);
  }
  assert.equal(await db.product.count({ where: { name: { startsWith: "Import forbidden" } } }), 0);
});
