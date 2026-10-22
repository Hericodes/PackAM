/**
 * Runner account states. A RUNNER account needs a RunnerProfile (created when operations sets the
 * runner up) and must be verified before it can go available or receive missions. Pure, so tested.
 *
 * Accounts can reach RUNNER without a profile (for example when a student account's role is changed
 * directly in the database). That is a set-up gap, not an error: the runner is told set-up is pending
 * and operations sees the account flagged, instead of the dashboard failing.
 */
export type RunnerProfileFlags = { isAvailable: boolean; isVerified: boolean } | null;

/** What the runner dashboard needs to know. Never creates anything. */
export function runnerDashboardStatus(profile: RunnerProfileFlags) {
  if (!profile) return { isAvailable: false, isVerified: false, profileMissing: true };
  return { isAvailable: profile.isAvailable, isVerified: profile.isVerified, profileMissing: false };
}

export type RunnerAccountView = { role: string; status: string; profile: RunnerProfileFlags };

/** Which operations actions apply to a runner account. The server re-checks on every request. */
export function runnerAdminActions(account: RunnerAccountView) {
  const eligible = account.role === "RUNNER" && account.status === "ACTIVE";
  return {
    setupNeeded: account.role === "RUNNER" && !account.profile,
    canVerify: eligible && !account.profile?.isVerified,
    canUnverify: eligible && Boolean(account.profile?.isVerified),
  };
}
