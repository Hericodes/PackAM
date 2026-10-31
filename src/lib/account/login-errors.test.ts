import assert from "node:assert/strict";
import { test } from "node:test";
import { LOGIN_ERROR_CODES, loginErrorMessage } from "./login-errors";

const REACH = "We couldn’t reach PackAM. Check your connection and try again.";

test("the codes are the ones src/auth.ts puts on its sign-in errors", () => {
  assert.deepEqual(LOGIN_ERROR_CODES, { credentials: "credentials", rate_limited: "rate_limited", inactive: "inactive" });
});

test("credentials failures: one message for wrong details, never saying whether an account exists", () => {
  const wrong = loginErrorMessage(LOGIN_ERROR_CODES.credentials, "CredentialsSignin");
  assert.equal(wrong, "That email, phone number or password isn’t right. Check them and try again.");
  assert.equal(loginErrorMessage(undefined, "CredentialsSignin"), wrong, "a missing code reads as wrong details");
  assert.equal(loginErrorMessage("something_new", "CredentialsSignin"), wrong, "so does a code this form doesn't know");
  assert.match(loginErrorMessage(LOGIN_ERROR_CODES.rate_limited, "CredentialsSignin"), /Too many sign-in attempts/);
  assert.match(loginErrorMessage(LOGIN_ERROR_CODES.inactive, "CredentialsSignin"), /paused or closed/);
  for (const code of Object.values(LOGIN_ERROR_CODES)) {
    assert.doesNotMatch(loginErrorMessage(code, "CredentialsSignin"), /no account|not found|doesn.t exist|not registered|unknown/i, code);
  }
});

test("server errors and failed requests ask the person to try again", () => {
  assert.equal(loginErrorMessage(undefined, "Configuration"), REACH);
  assert.equal(loginErrorMessage(undefined, "MissingCSRF"), REACH);
  assert.equal(loginErrorMessage(undefined, undefined), REACH);
  assert.equal(loginErrorMessage(LOGIN_ERROR_CODES.rate_limited, "Configuration"), REACH, "only credentials failures carry a meaningful code");
});
