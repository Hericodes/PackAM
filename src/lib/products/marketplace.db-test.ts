/**
 * The marketplace query through the real /api/search route against a disposable database: "All", a
 * category and a search each page through every visible product exactly once, and hidden or unpriced
 * products never appear. Run with `npm run test:db` (see src/test-support/db-harness.ts).
 */
import { callRoute, cleanupTestData, createTestCatalogue, dbTestSkip as skip, runTag, testDb } from "../../test-support/db-harness";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

type Page = { products: Array<{ id: string; name: string }>; total: number; page: number; hasMore: boolean };
let search: typeof import("../../app/api/search/route");
let db: Awaited<ReturnType<typeof testDb>>;

before(async () => {
  if (skip) return;
  db = await testDb();
  search = await import("../../app/api/search/route");
});
after(cleanupTestData);

async function everyPage(params: string) {
  const ids: string[] = [];
  for (let page = 1; page < 20; page += 1) {
    const response = await callRoute(search.GET, { path: `/api/search?${params}${params ? "&" : ""}page=${page}` });
    assert.equal(response.status, 200);
    const body = response.json as unknown as Page;
    ids.push(...body.products.map((product) => product.id));
    if (!body.hasMore) return { ids, total: body.total };
  }
  throw new Error("too many pages");
}

test("All, a category and a search each reach every visible product once, and never hidden ones", { skip }, async () => {
  const { categoryId, products } = await createTestCatalogue(Array.from({ length: 30 }, (_, i) => ({ name: `Pager ${runTag} ${String(i).padStart(2, "0")}`, price: 100 + i })));
  const category = await db.category.findUniqueOrThrow({ where: { id: categoryId } });
  const [hidden, unpriced] = products.slice(0, 2);
  await db.product.update({ where: { id: hidden.id }, data: { status: "INACTIVE" } });
  await db.product.update({ where: { id: unpriced.id }, data: { status: "INACTIVE", customerPrice: 0 } });
  const visible = products.slice(2).map((product) => product.id);

  const inCategory = await everyPage(`category=${category.slug}`);
  assert.equal(inCategory.total, 28);
  assert.deepEqual([...inCategory.ids].sort(), [...visible].sort(), "28 visible products across 2 pages, no repeats");

  const all = await everyPage("");
  assert.equal(new Set(all.ids).size, all.ids.length, "All never repeats a product across pages");
  for (const id of visible) assert.ok(all.ids.includes(id), "All includes every visible product, past the first 24");
  assert.ok(!all.ids.includes(hidden.id) && !all.ids.includes(unpriced.id), "hidden and unpriced products stay hidden");

  const searched = await everyPage(`q=${encodeURIComponent(`Pager ${runTag}`)}`);
  assert.deepEqual([...searched.ids].sort(), [...visible].sort());

  const empty = (await callRoute(search.GET, { path: `/api/search?q=${encodeURIComponent(`nothing-${runTag}`)}` })).json as unknown as Page;
  assert.deepEqual([empty.products.length, empty.total, empty.hasMore], [0, 0, false]);
  const beyond = (await callRoute(search.GET, { path: `/api/search?category=${category.slug}&page=9` })).json as unknown as Page;
  assert.deepEqual([beyond.products.length, beyond.hasMore], [0, false], "a page past the end is empty, not an error");
});
