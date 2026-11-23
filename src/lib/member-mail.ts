/**
 * Emails the website sends with members in cc (the members who vouched for an applicant), without
 * the website ever seeing their addresses: it names them by Discord id, the bot finds the address
 * (the one they gave the bot, else their Odoo contact linked to that Discord account) and sends.
 * The website only learns which of them can be reached, so the email can say who is in cc.
 */

import type { OdooCall } from "./odoo.ts";
import { getEnv } from "./utils.ts";

export const MAX_CC = 5;
const DISCORD_ID = /^\d{5,25}$/;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;
const FROM = "Commons Hub Brussels <hello@commonshub.brussels>";
const HELLO = "hello@commonshub.brussels";

export type AddressOf = (discordId: string) => Promise<string | undefined>;

/** Their address: what they gave the bot, else the email of their Odoo contact linked to that Discord account. */
export function addressFinder(guildId: string, stored: (guildId: string, discordId: string) => string | undefined, odoo: OdooCall | null): AddressOf {
  return async (discordId) => {
    const own = stored(guildId, discordId);
    if (own && EMAIL.test(own)) return own.trim();
    if (!odoo) return undefined;
    const found = (await odoo("res.partner", "search_read", { domain: [["x_discord_id", "=", discordId], ["email", "!=", false]], fields: ["email"], limit: 1 }).catch(() => [])) as { email: string | false }[];
    const email = typeof found[0]?.email === "string" ? found[0].email.trim() : "";
    return EMAIL.test(email) ? email : undefined;
  };
}

export const discordIds = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && DISCORD_ID.test(x)))].slice(0, MAX_CC) : []);

/** Which of them we have an address for (ids only). */
export async function reachable(ids: string[], addressOf: AddressOf): Promise<string[]> {
  return (await Promise.all(ids.map(async (id) => ((await addressOf(id)) ? id : null)))).filter((id): id is string => !!id);
}

export type MailInput = { to: { email: string; name: string }; ccDiscordIds: string[]; ccHello: boolean; subject: string; html: string; text: string };

export function parseMail(body: Record<string, unknown>): MailInput | { error: string } {
  const to = (body.to ?? {}) as { email?: unknown; name?: unknown };
  const email = typeof to.email === "string" ? to.email.trim() : "";
  if (!EMAIL.test(email) || email.length > 200) return { error: "to.email is required" };
  const name = typeof to.name === "string" ? to.name.replace(/[\n\r<>"]/g, "").slice(0, 80) : "";
  const subject = typeof body.subject === "string" ? body.subject.replace(/[\n\r]/g, " ").slice(0, 200) : "";
  const html = typeof body.html === "string" ? body.html : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!subject || !html || html.length > 200_000 || text.length > 100_000) return { error: "subject and html are required" };
  return { to: { email, name }, ccDiscordIds: discordIds(body.ccDiscordIds), ccHello: body.ccHello !== false, subject, html, text };
}

/** Send it, with the members we can reach in cc (and hello@). Never returns their addresses. */
export async function sendMail(m: MailInput, addressOf: AddressOf, post: typeof fetch = fetch): Promise<{ id: string; cc: string[] }> {
  const apiKey = getEnv("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  const found = await Promise.all(m.ccDiscordIds.map(async (id) => ({ id, email: await addressOf(id) })));
  const members = found.filter((f) => f.email && f.email.toLowerCase() !== m.to.email.toLowerCase());
  const cc = [...new Set([...members.map((f) => f.email!), ...(m.ccHello ? [HELLO] : [])])];
  const res = await post("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [m.to.name ? `"${m.to.name}" <${m.to.email}>` : m.to.email],
      ...(cc.length ? { cc } : {}),
      reply_to: [HELLO],
      subject: m.subject,
      html: m.html,
      ...(m.text ? { text: m.text } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return { id: body.id ?? "", cc: members.map((f) => f.id) };
}
