/** Email templates for invites and reset links. Plain text first; the HTML version is minimal. */
import type { Mail } from "./mailer.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const whenPkt = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: true });

function html(title: string, paragraphs: string[], link: string, button: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:#0b0d17;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#e5e7f0">
<div style="max-width:520px;margin:0 auto;background:#141726;border:1px solid #262a40;border-radius:14px;padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#ffffff">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55;font-size:15px">${esc(p)}</p>`).join("\n")}
<p style="margin:22px 0"><a href="${esc(link)}" style="display:inline-block;background:#5f58f0;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">${esc(button)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#9aa0b8">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${esc(link)}</span></p>
<p style="margin:16px 0 0;font-size:13px;color:#9aa0b8">${esc(footer)}</p>
</div></body></html>`;
}

export function inviteEmail(p: { to: string; name: string; inviter: string; role: string; link: string; expiresAt: Date }): Mail {
  const title = "You're invited to the Aamir AI Command Center";
  const lines = [
    `Hi ${p.name},`,
    `${p.inviter} has added you to the Aamir AI Command Center as ${p.role}.`,
    `Choose your password with the link below. It works once and expires on ${whenPkt(p.expiresAt)} (Pakistan time).`,
  ];
  const footer = "Didn't expect this? You can ignore this email; nothing happens until the link is used.";
  return {
    to: p.to,
    subject: title,
    text: `${lines.join("\n\n")}\n\n${p.link}\n\n${footer}\n`,
    html: html(title, lines, p.link, "Set my password", footer),
  };
}

export function resetEmail(p: { to: string; name: string; inviter: string; link: string; expiresAt: Date }): Mail {
  const title = "Reset your Command Center password";
  const lines = [
    `Hi ${p.name},`,
    `${p.inviter} sent you a link to choose a new password.`,
    `It works once and expires at ${whenPkt(p.expiresAt)} (Pakistan time). After you set the new password, you'll be signed out on all devices.`,
  ];
  const footer = "Didn't ask for this? Ignore this email: your current password keeps working until the link is used.";
  return {
    to: p.to,
    subject: title,
    text: `${lines.join("\n\n")}\n\n${p.link}\n\n${footer}\n`,
    html: html(title, lines, p.link, "Choose a new password", footer),
  };
}
