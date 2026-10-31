import "server-only";

import { after } from "next/server";

/**
 * Work that should happen after the response is sent (emails, file clean-up), so its timing reveals nothing and a
 * slow provider can't hold the response up. Inside a Next request it is handed to after(); with no request scope
 * (database tests call handlers directly, where after() throws) it runs inline before this resolves, so tests see
 * its effects deterministically. Never throws: a failure is logged by error name only, in either path.
 */
export async function afterResponse(task: () => Promise<void>): Promise<void> {
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      console.error("AFTER RESPONSE ERROR:", error instanceof Error ? error.name : "Unknown error");
    }
  };
  try {
    after(guarded);
  } catch {
    await guarded();
  }
}
