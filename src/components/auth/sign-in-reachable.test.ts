import assert from "node:assert/strict";
import { test } from "node:test";
import { canSignIn } from "./sign-in-reachable";

const CREDENTIALS = { credentials: { id: "credentials", name: "Credentials", type: "credentials", signinUrl: "/api/auth/signin/credentials", callbackUrl: "/api/auth/callback/credentials" } };

test("signing in only starts when the browser is online and the provider list arrives with the credentials provider", async () => {
  assert.equal(await canSignIn({ online: () => true, providers: async () => CREDENTIALS }), true);

  let asked = 0;
  const offline = await canSignIn({ online: () => false, providers: async () => { asked += 1; return CREDENTIALS; } });
  assert.equal(offline, false, "offline: no sign-in, so next-auth never leaves for /api/auth/error");
  assert.equal(asked, 0, "and nothing is fetched");

  assert.equal(await canSignIn({ online: () => true, providers: async () => null }), false, "next-auth answers null when the list couldn't be fetched");
  assert.equal(await canSignIn({ online: () => true, providers: async () => { throw new TypeError("Failed to fetch"); } }), false, "never throws");
  assert.equal(await canSignIn({ online: () => true, providers: async () => ({}) }), false, "no credentials provider: signIn would leave for its own page");
  assert.equal(await canSignIn({ online: () => true, providers: async () => "credentials" }), false);
});
