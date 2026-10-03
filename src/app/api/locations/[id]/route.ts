import { auth } from "../../../../auth";
import { db } from "../../../../lib/db";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return Response.json(
        { error: "You must be logged in." },
        { status: 401 },
      );
    }

    if (session.user.role !== "STUDENT") {
      return Response.json(
        { error: "Only students can manage delivery locations." },
        { status: 403 },
      );
    }

    const { id } = await params;

    const location = await db.savedLocation.findFirst({
      where: {
        id,
        userId: session.user.id,
      },
    });

    if (!location) {
      return Response.json(
        { error: "Delivery location not found." },
        { status: 404 },
      );
    }

    await db.savedLocation.delete({
      where: {
        id: location.id,
      },
    });

    return Response.json({
      message: "Delivery location removed.",
    });
  } catch (error) {
    console.error("DELETE LOCATION ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return Response.json(
      { error: "Unable to remove this delivery location." },
      { status: 500 },
    );
  }
}