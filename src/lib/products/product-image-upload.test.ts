import assert from "node:assert/strict";
import { test } from "node:test";
import { UPLOAD_ABORTED, uploadProductImage, type UploadDeps, type UploadRequest } from "./product-image-upload";

const CLOUD = "packam-cloud";
const credentials = { cloudName: CLOUD, apiKey: "public-key", timestamp: 1_790_000_000, folder: "packam/products", allowedFormats: "jpg,png,webp", signature: "signed-by-server" };
const goodAnswer = { resource_type: "image", type: "upload", public_id: "packam/products/abc", format: "jpg", bytes: 300_000, secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/packam/products/abc.jpg` };
const file = () => new File([new Uint8Array(300_000)], "shelf.jpg", { type: "image/jpeg" });

type Outcome = { status: number; body: unknown } | "network-error" | "hang";

/** A fake network: the signing endpoint answers `sign`, then each Cloudinary upload takes the next outcome. */
function network(sign: { ok: boolean; body: unknown } | "offline", outcomes: Outcome[]) {
  const sent: FormData[] = [];
  const opened: string[] = [];
  let signCalls = 0;
  const deps: UploadDeps = {
    fetch: async () => {
      signCalls += 1;
      if (sign === "offline") throw new TypeError("Failed to fetch");
      return { ok: sign.ok, json: async () => sign.body };
    },
    createRequest: () => {
      const outcome = outcomes.shift() ?? "network-error";
      const request: UploadRequest = {
        upload: { onprogress: null },
        onload: null, onerror: null, onabort: null, status: 0, responseText: "",
        open: (_method, url) => { opened.push(url); },
        abort: () => setTimeout(() => request.onabort?.(), 0),
        send: (body) => {
          sent.push(body);
          setTimeout(() => {
            if (outcome === "hang") return;
            if (outcome === "network-error") return request.onerror?.();
            request.upload.onprogress?.({ lengthComputable: true, loaded: 150, total: 300 });
            request.upload.onprogress?.({ lengthComputable: true, loaded: 300, total: 300 });
            request.status = outcome.status;
            request.responseText = JSON.stringify(outcome.body);
            request.onload?.();
          }, 0);
        },
      };
      return request;
    },
  };
  return { deps, sent, opened, signCalls: () => signCalls };
}

test("upload: signed by PackAM, sent straight to Cloudinary with progress, verified before use", async () => {
  const net = network({ ok: true, body: credentials }, [{ status: 200, body: goodAnswer }]);
  const progress: number[] = [];
  const url = await uploadProductImage(file(), (p) => progress.push(p), () => {}, net.deps);
  assert.equal(url, goodAnswer.secure_url);
  assert.deepEqual(progress, [50, 100]);
  assert.deepEqual(net.opened, [`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`]);
  const body = net.sent[0];
  assert.equal(body.get("signature"), "signed-by-server");
  assert.equal(body.get("folder"), "packam/products");
  assert.equal(body.get("allowed_formats"), "jpg,png,webp");
  assert.equal(body.get("api_secret"), null, "the secret never reaches the browser");
});

test("upload: a refused signature (not an admin, rate limited, storage off) explains itself", async () => {
  const net = network({ ok: false, body: { error: "Only PackAM admins can upload product images." } }, []);
  await assert.rejects(uploadProductImage(file(), () => {}, () => {}, net.deps), /Only PackAM admins/);
  assert.equal(net.sent.length, 0, "nothing is uploaded without a signature");
  const offline = network("offline", []);
  await assert.rejects(uploadProductImage(file(), () => {}, () => {}, offline.deps), /Couldn’t reach PackAM/);
});

test("upload: network failures, storage refusals and unverifiable answers all fail with a retryable message", async () => {
  await assert.rejects(uploadProductImage(file(), () => {}, () => {}, network({ ok: true, body: credentials }, ["network-error"]).deps), /couldn’t reach image storage/);
  await assert.rejects(uploadProductImage(file(), () => {}, () => {}, network({ ok: true, body: credentials }, [{ status: 400, body: { error: { message: "Invalid image file" } } }]).deps), /refused the file: Invalid image file/);
  await assert.rejects(uploadProductImage(file(), () => {}, () => {}, network({ ok: true, body: credentials }, [{ status: 200, body: { ...goodAnswer, public_id: "elsewhere/abc" } }]).deps), /couldn’t be confirmed/);
});

test("upload: retrying after a failure uploads the same file again and succeeds", async () => {
  const net = network({ ok: true, body: credentials }, ["network-error", { status: 200, body: goodAnswer }]);
  const photo = file();
  await assert.rejects(uploadProductImage(photo, () => {}, () => {}, net.deps));
  assert.equal(await uploadProductImage(photo, () => {}, () => {}, net.deps), goodAnswer.secure_url);
  assert.equal(net.sent.length, 2);
  const [first, second] = net.sent.map((body) => body.get("file") as File);
  assert.ok(first.name === "shelf.jpg" && second.name === first.name && second.size === first.size, "the same photo is sent again");
  assert.equal(net.signCalls(), 2, "each attempt gets a fresh signature");
});

test("upload: cancelling stops the upload and reports it as cancelled, not as an error", async () => {
  const net = network({ ok: true, body: credentials }, ["hang"]);
  let abort = () => {};
  const pending = uploadProductImage(file(), () => {}, (cancel) => { abort = cancel; }, net.deps);
  await new Promise((resolve) => setTimeout(resolve, 5));
  abort();
  await assert.rejects(pending, new RegExp(UPLOAD_ABORTED));
});
