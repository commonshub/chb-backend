/** lib/member-mail.ts: members in cc by Discord id; the website never gets their addresses back. */
import { expect } from "@std/expect/expect";
import { addressFinder, discordIds, parseMail, reachable, sendMail } from "../src/lib/member-mail.ts";

const GUILD = "1280532848604086365";
const stored = (_g: string, id: string) => (id === "111111111111" ? "alex@example.org" : undefined);
const odoo = (async (_model: string, _method: string, args: { domain: unknown[][] }) =>
  args.domain[0][2] === "222222222222" ? [{ email: "inge@example.org" }] : []) as never;

Deno.test("addresses: the one given to the bot, else the Odoo contact linked to the Discord id", async () => {
  const of = addressFinder(GUILD, stored, odoo);
  expect(await of("111111111111")).toBe("alex@example.org");
  expect(await of("222222222222")).toBe("inge@example.org");
  expect(await of("333333333333")).toBeUndefined();
  expect(await reachable(["111111111111", "222222222222", "333333333333"], of)).toEqual(["111111111111", "222222222222"]);
});

Deno.test("discordIds: only ids, deduplicated, at most five", () => {
  expect(discordIds(["111111111111", "111111111111", "x", 3, "<@1>"])).toEqual(["111111111111"]);
  expect(discordIds(Array.from({ length: 9 }, (_, i) => `1234567890${i}`)).length).toBe(5);
  expect(discordIds("111111111111")).toEqual([]);
});

Deno.test("parseMail: needs an address, a subject and html", () => {
  expect("error" in parseMail({ to: { email: "nope" }, subject: "s", html: "<p>h</p>" })).toBe(true);
  expect("error" in parseMail({ to: { email: "a@b.be" }, html: "<p>h</p>" })).toBe(true);
  const m = parseMail({ to: { email: "a@b.be", name: "A\n<b>" }, subject: "Hi\nthere", html: "<p>h</p>", ccDiscordIds: ["111111111111"] });
  expect("error" in m ? null : { name: m.to.name, subject: m.subject, cc: m.ccDiscordIds, hello: m.ccHello }).toEqual({ name: "Ab", subject: "Hi there", cc: ["111111111111"], hello: true });
});

Deno.test("sendMail: cc the members found (not the recipient) and hello@; returns ids, not addresses", async () => {
  Deno.env.set("RESEND_API_KEY", "re_test");
  let sent: Record<string, unknown> = {};
  const post = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
  }) as typeof fetch;
  try {
    const of = addressFinder(GUILD, stored, odoo);
    const r = await sendMail({ to: { email: "INGE@example.org", name: "Inge" }, ccDiscordIds: ["111111111111", "222222222222", "333333333333"], ccHello: true, subject: "s", html: "<p>h</p>", text: "h" }, of, post);
    expect(r).toEqual({ id: "email_1", cc: ["111111111111"] });
    expect(sent.cc).toEqual(["alex@example.org", "hello@commonshub.brussels"]);
    expect(sent.to).toEqual(['"Inge" <INGE@example.org>']);
    expect(sent.reply_to).toEqual(["hello@commonshub.brussels"]);
  } finally {
    Deno.env.delete("RESEND_API_KEY");
  }
});
