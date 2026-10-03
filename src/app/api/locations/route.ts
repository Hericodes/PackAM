import { auth } from "../../../auth";
import { db } from "../../../lib/db";

export async function GET() {
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

    const locations = await db.savedLocation.findMany({
      where: {
        userId: session.user.id,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return Response.json({ locations });
  } catch (error) {
    console.error("GET LOCATIONS ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return Response.json(
      { error: "Unable to load your delivery locations." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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
        { error: "Only students can add delivery locations." },
        { status: 403 },
      );
    }

    const body = await request.json();

    const label =
      typeof body?.label === "string" ? body.label.trim() : "";

    const address =
      typeof body?.address === "string" ? body.address.trim() : "";

    const instructions =
      typeof body?.instructions === "string"
        ? body.instructions.trim()
        : "";

    const latitude =
      body?.latitude !== undefined &&
      body?.latitude !== null &&
      body?.latitude !== ""
        ? Number(body.latitude)
        : null;

    const longitude =
      body?.longitude !== undefined &&
      body?.longitude !== null &&
      body?.longitude !== ""
        ? Number(body.longitude)
        : null;

    if (!label) {
      return Response.json(
        { error: "Please give this location a name." },
        { status: 400 },
      );
    }

    if (!address) {
      return Response.json(
        { error: "Please enter a delivery address." },
        { status: 400 },
      );
    }

    if (label.length > 50) {
      return Response.json(
        { error: "Location name is too long." },
        { status: 400 },
      );
    }

    if (address.length > 300) {
      return Response.json(
        { error: "Address is too long." },
        { status: 400 },
      );
    }

    if (instructions.length > 500) {
      return Response.json(
        { error: "Delivery instructions are too long." },
        { status: 400 },
      );
    }

    if (
      latitude !== null &&
      (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    ) {
      return Response.json(
        { error: "Invalid latitude." },
        { status: 400 },
      );
    }

    if (
      longitude !== null &&
      (!Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180)
    ) {
      return Response.json(
        { error: "Invalid longitude." },
        { status: 400 },
      );
    }

    const location = await db.savedLocation.create({
      data: {
        userId: session.user.id,
        label,
        address,
        instructions: instructions || null,
        latitude,
        longitude,
      },
    });

    return Response.json(
      {
        message: "Delivery location saved.",
        location,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("CREATE LOCATION ERROR:", (error instanceof Error ? error.name : "Unknown error"));

    return Response.json(
      { error: "Unable to save this delivery location." },
      { status: 500 },
    );
  }
}