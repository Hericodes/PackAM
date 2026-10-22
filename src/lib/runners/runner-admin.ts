import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "../db";
import { retrySerializable } from "../db-retry";
import { writeAuditLog } from "../audit";
import { createNotification } from "../notifications";

export type RunnerVerificationResult =
  | { kind: "UPDATED"; profileCreated: boolean; isVerified: boolean }
  | { kind: "UNCHANGED"; isVerified: boolean }
  | { kind: "NOT_A_RUNNER" }
  | { kind: "NOT_FOUND" };

/**
 * Operations sets up and verifies (or un-verifies) a runner. The profile is created only if the account
 * has none: RunnerProfile.userId is unique and this runs as one serializable upsert, so repeated or
 * concurrent clicks can never create a second profile. Un-verifying also takes the runner offline.
 * Every change is audited with the admin's identity.
 */
export async function setRunnerVerification(adminId: string, userId: string, verified: boolean): Promise<RunnerVerificationResult> {
  try {
    return await applyRunnerVerification(adminId, userId, verified);
  } catch (error) {
    // Two admins creating the same profile at once: the unique userId rejects the second insert.
    // Re-reading then finds the profile the first request created, so nothing is duplicated.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return applyRunnerVerification(adminId, userId, verified);
    throw error;
  }
}

function applyRunnerVerification(adminId: string, userId: string, verified: boolean): Promise<RunnerVerificationResult> {
  return retrySerializable(() => db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, status: true, runnerProfile: { select: { id: true, isVerified: true, isAvailable: true } } } });
    if (!user) return { kind: "NOT_FOUND" as const };
    // Only an active RUNNER account can be set up; this never changes anyone's role.
    if (user.role !== "RUNNER" || user.status !== "ACTIVE") return { kind: "NOT_A_RUNNER" as const };
    const before = user.runnerProfile;
    if (before && before.isVerified === verified) return { kind: "UNCHANGED" as const, isVerified: verified };

    await tx.runnerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, isVerified: verified, isAvailable: false },
      update: verified ? { isVerified: true } : { isVerified: false, isAvailable: false },
    });
    await writeAuditLog(tx, {
      actorId: adminId,
      action: verified ? "RUNNER_VERIFIED" : "RUNNER_UNVERIFIED",
      resource: "User",
      resourceId: user.id,
      previousState: before ? { profile: true, isVerified: before.isVerified, isAvailable: before.isAvailable } : { profile: false },
      newState: { profile: true, isVerified: verified, isAvailable: verified ? (before?.isAvailable ?? false) : false },
      details: before ? undefined : "Runner profile created during set-up.",
    });
    if (verified) {
      await createNotification(tx, {
        userId: user.id,
        type: "DELIVERY",
        title: "You’re verified 🫡",
        message: "Your PackAM runner account is ready. Go available on your dashboard to start getting missions.",
        idempotencyKey: `runner-verified:${user.id}:${Date.now()}`,
      });
    }
    return { kind: "UPDATED" as const, profileCreated: !before, isVerified: verified };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), { attempts: 5, baseDelayMs: 25 });
}
