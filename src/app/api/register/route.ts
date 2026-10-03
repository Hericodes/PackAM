import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { db } from "../../../lib/db";
import { clientAddress, consumeRateLimit } from "../../../lib/rate-limit";

export async function POST(request: Request) {
  try {
    const rate = await consumeRateLimit(`register:${clientAddress(request)}`, 5, 60 * 60 * 1000);
    if (!rate.allowed) return NextResponse.json({ success: false, message: "Too many attempts. Please try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
    const body = await request.json();

    const firstName =
      typeof body.firstName === "string"
        ? body.firstName.trim()
        : "";

    const lastName =
      typeof body.lastName === "string"
        ? body.lastName.trim()
        : "";

    const email =
      typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const phone =
      typeof body.phone === "string"
        ? body.phone.trim()
        : "";

    const password =
      typeof body.password === "string"
        ? body.password
        : "";

    if (!firstName || !lastName || !email || !phone || !password) {
      return NextResponse.json(
        {
          success: false,
          message: "Please fill in all required fields.",
        },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        {
          success: false,
          message: "Password must be at least 8 characters.",
        },
        { status: 400 }
      );
    }

    const existingUser = await db.user.findFirst({
      where: {
        OR: [
          {
            email,
          },
          {
            phone,
          },
        ],
      },
      select: {
        email: true,
        phone: true,
      },
    });

    if (existingUser) {
      if (existingUser.email === email) {
        return NextResponse.json(
          {
            success: false,
            message: "An account with this email already exists.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: "An account with this phone number already exists.",
        },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await db.$transaction(async (transaction) => {
      const newUser = await transaction.user.create({
        data: {
          firstName,
          lastName,
          email,
          phone,
          passwordHash,

          // Registration is always for students.
          // Users cannot choose their own role.
          role: "STUDENT",

          status: "ACTIVE",

          studentProfile: {
            create: {},
          },

          carts: {
            create: {},
          },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
        },
      });

      return newUser;
    });

    return NextResponse.json(
      {
        success: true,
        message: "Your PackAM account has been created.",
        user,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", (error instanceof Error ? error.name : "Unknown error"));

    return NextResponse.json(
      {
        success: false,
        message: "Something went wrong while creating your account.",
      },
      { status: 500 }
    );
  }
}
