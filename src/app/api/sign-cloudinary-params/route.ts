import { v2 as cloudinary } from "cloudinary";
import { auth } from "../../../auth";
import { consumeRateLimit } from "../../../lib/rate-limit";

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user || !["ADMIN", "RUNNER"].includes(session.user.role)) return Response.json({ error: "Sign in with an operations account to upload product images." }, { status: 403 });
    const rate = await consumeRateLimit(`cloudinary-sign:${session.user.id}`, 20, 60 * 60 * 1000);
    if (!rate.allowed) return Response.json({ error: "Upload limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 10_000) return Response.json({ error: "Upload parameters are too large." }, { status: 413 });
    const body: unknown = await request.json();
    const paramsToSign = body && typeof body === "object" && !Array.isArray(body) ? (body as { paramsToSign?: unknown }).paramsToSign : undefined;
    if (!paramsToSign || typeof paramsToSign !== "object" || Array.isArray(paramsToSign)) {
      return Response.json(
        { error: "Missing parameters to sign." },
        { status: 400 },
      );
    }

    const params = paramsToSign as Record<string, unknown>;
    const allowed = new Set(["folder", "timestamp", "source"]);
    if (Object.keys(params).some((key) => !allowed.has(key)) || params.folder !== "packam/products" || params.source !== "uw" || !Number.isSafeInteger(params.timestamp) || Math.abs(Date.now() / 1000 - Number(params.timestamp)) > 600 || Object.values(params).some((value) => !(typeof value === "string" || typeof value === "number"))) {
      return Response.json({ error: "Upload parameters are not allowed." }, { status: 400 });
    }

    const signature = cloudinary.utils.api_sign_request(
      params,
      process.env.CLOUDINARY_API_SECRET!,
    );

    return Response.json({
      signature,
      apiKey: process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY,
    });
  } catch (error) {
    console.error("CLOUDINARY SIGNATURE ERROR:", error instanceof Error ? error.name : "Unknown error");

    return Response.json(
      { error: "Unable to generate upload signature." },
      { status: 500 },
    );
  }
}
