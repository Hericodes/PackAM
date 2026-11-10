import assert from "node:assert/strict";
import { test } from "node:test";
import { MORNING_MESSAGES } from "./campaign-rules";
import { announcementEmail, morningEmail, orderUpdateEmail, reminderEmail, resetPassword, type AutomatedFooter } from "./templates";

const footer: AutomatedFooter = { noun: "good-morning emails", unsubscribeUrl: "https://www.packam.app/email/unsubscribe?t=abc.def", manageUrl: "https://www.packam.app/settings#emails" };

test("the good-morning email greets by name, says today's hours, links to PackAM and can be stopped", () => {
  const email = morningEmail("Ade", MORNING_MESSAGES[0], "8am to 5pm", "https://www.packam.app/", footer);
  assert.equal(email.subject, MORNING_MESSAGES[0].subject);
  for (const part of [email.text, email.html]) {
    assert.match(part, /Hi Ade,/);
    assert.match(part, /We’re taking orders today from 8am to 5pm\./);
    assert.match(part, /Order on PackAM/);
  }
  assert.match(email.text, /Stop good-morning emails: https:\/\/www\.packam\.app\/email\/unsubscribe\?t=abc\.def/);
  assert.match(email.text, /All email settings: https:\/\/www\.packam\.app\/settings#emails/);
  assert.match(email.html, /<a href="https:\/\/www\.packam\.app\/email\/unsubscribe\?t=abc\.def"[^>]*>Stop good-morning emails<\/a>/);
  assert.match(email.html, />Email settings<\/a>/);
});

test("the reminder names the closing time", () => {
  const email = reminderEmail(null, "5pm", "https://www.packam.app/", { ...footer, noun: "order reminders" });
  assert.equal(email.subject, "Ordering closes at 5pm today ⏰");
  assert.match(email.text, /^Hi there,/);
  assert.match(email.text, /Stop order reminders:/);
});

test("an order update carries the bell's title and message and links to the order", () => {
  const email = orderUpdateEmail("Ade", { title: "On the way", message: "Your package dey road 🛵", orderRef: "AB12CD34", orderUrl: "https://www.packam.app/orders/cm1" }, { ...footer, noun: "order update emails" });
  assert.equal(email.subject, "On the way · PackAM order AB12CD34");
  assert.match(email.html, /Your package dey road 🛵/);
  assert.match(email.html, /href="https:\/\/www\.packam\.app\/orders\/cm1"/);
});

test("an admin's announcement is escaped: their words can't become markup", () => {
  const email = announcementEmail("Ade", { subject: "<b>Big</b> news", paragraphs: ["Click <a href=\"x\">here</a> & win", "Second paragraph"], buttonLabel: "Order now", buttonUrl: "https://www.packam.app/food" }, { ...footer, noun: "news and offers" });
  assert.equal(email.subject, "<b>Big</b> news", "the subject is plain text");
  assert.doesNotMatch(email.html, /<b>Big<\/b>|<a href="x">/);
  assert.match(email.html, /&lt;b&gt;Big&lt;\/b&gt; news/);
  assert.match(email.html, /Click &lt;a href=&quot;x&quot;&gt;here&lt;\/a&gt; &amp; win/);
  assert.match(email.html, /Second paragraph/);
  assert.match(email.html, /href="https:\/\/www\.packam\.app\/food"/);
  assert.equal(announcementEmail(null, { subject: "Hi", paragraphs: ["Text"], buttonLabel: null, buttonUrl: null }, footer).html.includes("If the button doesn’t work"), false, "no button without one");
});

test("unsafe footer links are refused, and account emails keep their own footer", () => {
  assert.throws(() => morningEmail("Ade", MORNING_MESSAGES[0], "8am to 5pm", "https://www.packam.app/", { ...footer, unsubscribeUrl: "javascript:alert(1)" }));
  const reset = resetPassword("Ade", "https://www.packam.app/reset-password?token=x");
  assert.match(reset.text, /You’re getting this email because it’s about your PackAM account\./);
  assert.doesNotMatch(reset.text, /Stop |unsubscribe/i, "security emails can't be unsubscribed from");
});
