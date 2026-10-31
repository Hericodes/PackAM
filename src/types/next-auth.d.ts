import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    id: string;
    role: "STUDENT" | "RUNNER" | "ADMIN";
    /** Returned by authorize() for the sign-in only, where src/auth.ts copies it onto the token. */
    sessionVersion?: number;
  }

  interface Session {
    user: {
      id: string;
      role: "STUDENT" | "RUNNER" | "ADMIN";
      /** True once the account's current email address has been confirmed. Read fresh on every request. */
      emailVerified: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "STUDENT" | "RUNNER" | "ADMIN";
    /** User.sessionVersion when this cookie was issued; a different current value ends the session. Missing = 0. */
    sessionVersion?: number;
    /** Refreshed from the database on every request. */
    emailVerified?: boolean;
  }
}
