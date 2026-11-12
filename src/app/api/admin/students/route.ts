import { db } from "../../../../lib/db";
import { adminApiAccess } from "../../../../lib/admin/admin-access";

export const runtime = "nodejs";

/**
 * Admin checkout's "Who is this order for?": active student accounts matching ?q= (name, email or phone), at most 8,
 * each with their saved delivery locations. Needs at least 2 characters.
 */
export async function GET(request: Request) {
  const allowed = await adminApiAccess();
  if (!allowed.ok) return allowed.response;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return Response.json({ students: [] });
  const words = q.split(/\s+/).filter(Boolean).slice(0, 3);
  try {
    const students = await db.user.findMany({
      where: {
        role: "STUDENT",
        status: "ACTIVE",
        AND: words.map((word) => ({
          OR: [
            { firstName: { contains: word, mode: "insensitive" as const } },
            { lastName: { contains: word, mode: "insensitive" as const } },
            { email: { contains: word.toLowerCase() } },
            { phone: { contains: word.replace(/\s+/g, "") } },
          ],
        })),
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 8,
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        savedLocations: { orderBy: { updatedAt: "desc" }, take: 5, select: { id: true, label: true, address: true, instructions: true, latitude: true, longitude: true } },
      },
    });
    return Response.json({
      students: students.map((student) => ({
        id: student.id,
        name: [student.firstName, student.lastName].filter(Boolean).join(" ") || student.email,
        email: student.email,
        phone: student.phone,
        locations: student.savedLocations,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("ADMIN STUDENT SEARCH ERROR:", error instanceof Error ? error.name : "Unknown error");
    return Response.json({ error: "We couldn’t search students right now. Try again." }, { status: 500 });
  }
}
