import type { APIRoute } from "astro";

// V2 — Marketing Site Premium Redesign / functional contact form. The one
// server-side route on this otherwise fully static site (see
// astro.config.mjs) — needs `export const prerender = false` plus the
// Vercel adapter to run as a serverless function instead of being
// pre-rendered away at build time.
export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_INBOX = "contact@nalynt.ch";
const MAX_FIELD_LENGTH = 5000;

interface ContactPayload {
  name: string;
  email: string;
  subject: string;
  message: string;
}

function readField(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FIELD_LENGTH) return null;
  return trimmed;
}

function parsePayload(body: unknown): ContactPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;

  const name = readField(record, "name");
  const email = readField(record, "email");
  const subject = readField(record, "subject");
  const message = readField(record, "message");

  if (!name || !email || !subject || !message || !EMAIL_RE.test(email)) {
    return null;
  }
  return { name, email, subject, message };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function emailField(label: string, value: string): string {
  const safeValue = escapeHtml(value).replace(/\n/g, "<br>");
  return `
    <tr>
      <td style="padding:18px 0;border-top:1px solid #24262a;">
        <div style="font-family:${EMAIL_FONT_STACK};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#D4AF37;">
          ${escapeHtml(label)}
        </div>
        <div style="margin-top:6px;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:1.6;color:#F5F5F0;white-space:pre-wrap;">
          ${safeValue}
        </div>
      </td>
    </tr>`;
}

/**
 * Table-based layout + inline CSS only — no external stylesheet, no webfont,
 * no background image, no flex/grid — for compatibility across mail clients
 * (Gmail, Apple Mail, Outlook). This is an internal notification email (one
 * recipient, contact@nalynt.ch), not a broadcast campaign, so it's built for
 * solid rendering in modern clients rather than pixel-perfect legacy-Outlook
 * bulletproofing.
 */
function buildContactEmailHtml(payload: ContactPayload): string {
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background-color:#08090B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#08090B;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#12151A;border-radius:6px;">
            <tr>
              <td style="padding:36px 32px 4px 32px;text-align:center;">
                <span style="font-family:${EMAIL_FONT_STACK};font-size:13px;font-weight:700;letter-spacing:5px;text-transform:uppercase;color:#D4AF37;">
                  NALYNT
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 32px 28px 32px;text-align:center;">
                <span style="font-family:${EMAIL_FONT_STACK};font-size:20px;font-weight:600;color:#F5F5F0;">
                  Nouvelle demande de contact
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${emailField("Nom", payload.name)}
                  ${emailField("Email", payload.email)}
                  ${emailField("Sujet", payload.subject)}
                  ${emailField("Message", payload.message)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 32px 32px;text-align:center;border-top:1px solid #24262a;">
                <span style="font-family:${EMAIL_FONT_STACK};font-size:11px;color:#8b9098;">
                  Envoyé depuis le formulaire de contact — nalynt.ch
                </span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export const POST: APIRoute = async ({ request }) => {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return new Response(JSON.stringify({ error: "invalid_fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Server-only env var — never prefixed PUBLIC_, so Astro never bundles it
  // into client-side JS. Set as a Vercel project environment variable.
  const apiKey = import.meta.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("api/contact: RESEND_API_KEY is not configured");
    return new Response(JSON.stringify({ error: "server_not_configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let resendResponse: Response;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "NALYNT Contact <contact@nalynt.ch>",
        to: CONTACT_INBOX,
        reply_to: payload.email,
        subject: `[NALYNT Contact] ${payload.subject}`,
        text: `From: ${payload.name} <${payload.email}>\n\n${payload.message}`,
        html: buildContactEmailHtml(payload),
      }),
    });
  } catch (networkError) {
    console.error("api/contact: network error calling Resend", networkError);
    return new Response(JSON.stringify({ error: "send_failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!resendResponse.ok) {
    console.error("api/contact: Resend request failed", resendResponse.status);
    return new Response(JSON.stringify({ error: "send_failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
