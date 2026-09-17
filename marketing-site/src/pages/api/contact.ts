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
        from: "NALYNT Contact <onboarding@resend.dev>",
        to: CONTACT_INBOX,
        reply_to: payload.email,
        subject: `[NALYNT Contact] ${payload.subject}`,
        text: `From: ${payload.name} <${payload.email}>\n\n${payload.message}`,
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
