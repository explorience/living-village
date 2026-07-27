// Editable email templates for the Living Village.
//
// One registry, one source of truth. Each template carries its built-in default copy
// (subject / body / reply-to) plus the tokens it understands. Crew can override any field
// from the backstage; overrides live in the `email_templates` table. At send time we merge
// DB-over-defaults, substitute tokens, and generate the HTML from the plain-text body — so
// there's no second HTML copy to keep in sync. If the DB is unreachable we fall back to the
// built-in defaults, so a database hiccup can never break a signup or send a blank email.

import { getEmailTemplateRow, getAllEmailTemplateRows, saveEmailTemplateRow } from './db.js';

// --- Built-in default copy (what ships before anyone edits anything) ---

const RSVP_BODY = `Hi {firstName},

Your yes landed. Thank you for the care you put into your answers. We read every one.

The Living Village gathers on the land, August 15–16, 2026. Hold the dates. We'll be in touch before then with arrival details, what to bring, and how the two days will flow.

Until then: this isn't a ticket you bought, it's a village you're helping make. If something stirs, or you think of something you'd love to bring, just reply to this email and it reaches us directly.

See you on the land,
The Living Village`;

const SIGNIN_BODY = `Hi,

Here's your sign-in link for the Living Village. It works for {expiry}.

{link}

If you didn't request this, you can safely ignore this email.

The Living Village`;

// key -> definition. Adding a future email is just another entry here.
export const TEMPLATES = {
  rsvp_confirmation: {
    label: 'RSVP confirmation',
    description: 'Sent automatically the moment someone completes their signup.',
    tokens: [
      { name: 'firstName', help: "the person's first name (becomes “there” if we don't have it)" },
    ],
    fromEnv: 'RESEND_FROM',
    fromDefault: 'The Living Village <onboarding@resend.dev>',
    defaults: {
      subject: 'Your yes is received. The Living Village, Aug 15–16 🌱',
      body: RSVP_BODY,
      replyTo: 'hello@journeyland.ca',
    },
  },
  signin_link: {
    label: 'Sign-in link',
    description: 'The one-tap login email crew and attendees get when they request access.',
    tokens: [
      { name: 'link', help: 'the sign-in button and its paste-able URL, always keep this one in' },
      { name: 'expiry', help: 'how long the link lasts (auto-fills “20 minutes” for crew, “6 weeks” for attendees)' },
    ],
    fromEnv: 'MAGIC_LINK_FROM',
    fromDefault: 'The Living Village <hello@livingvillage.ca>',
    defaults: {
      subject: 'Your Living Village sign-in link',
      body: SIGNIN_BODY,
      replyTo: 'hello@journeyland.ca',
    },
  },
};

// --- Token substitution + HTML generation ---

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// {link} in HTML becomes the styled button + a paste-able fallback URL, so a login link is
// always tappable and always recoverable if the button gets stripped by a mail client.
function linkButtonHtml(url) {
  const u = escapeHtml(url);
  return `<a href="${u}" style="display:inline-block;background:#3f6b52;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:15px;">Sign in</a>`
    + `<br><span style="color:#6b6760;font-size:13px;">Or paste this link into your browser:<br>`
    + `<a href="${u}" style="color:#3f6b52;word-break:break-all;">${u}</a></span>`;
}

function substituteText(s, { firstName, link, expiry } = {}) {
  return String(s)
    .replace(/\{firstName\}/g, firstName != null && firstName !== '' ? firstName : 'there')
    .replace(/\{expiry\}/g, expiry != null ? expiry : '')
    .replace(/\{link\}/g, link != null ? link : '');
}

// Escape the whole body first (so any stray < or & a crew member types is safe), then split
// into paragraphs and substitute tokens. Braces aren't escaped, so {tokens} survive the
// escape pass intact and we control exactly what each one expands to.
function bodyToHtml(body, tokens = {}) {
  const escaped = escapeHtml(body);
  const paras = escaped
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;">${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n  ');
  const withTokens = paras
    .replace(/\{firstName\}/g, escapeHtml(tokens.firstName != null && tokens.firstName !== '' ? tokens.firstName : 'there'))
    .replace(/\{expiry\}/g, escapeHtml(tokens.expiry != null ? tokens.expiry : ''))
    .replace(/\{link\}/g, tokens.link ? linkButtonHtml(tokens.link) : '');
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#2c2a26;line-height:1.6;font-size:16px;">
  ${withTokens}
</div>`;
}

// The from-address is NOT crew-editable (a wrong sender breaks delivery), so it stays in env,
// resolved here so both the live senders and the test-send agree on it.
export function fromAddrFor(key) {
  const def = TEMPLATES[key];
  if (!def) throw new Error(`Unknown email template: ${key}`);
  return process.env[def.fromEnv] || def.fromDefault;
}

// Render explicit copy (used by the test-send, which previews an unsaved draft).
export function renderFromValues(key, { subject, body, replyTo }, tokens = {}) {
  if (!TEMPLATES[key]) throw new Error(`Unknown email template: ${key}`);
  return {
    subject: substituteText(subject, tokens).trim(),
    text: substituteText(body, tokens),
    html: bodyToHtml(body, tokens),
    replyTo: String(replyTo || '').trim(),
  };
}

// --- Merge DB overrides over defaults ---

// A stored-but-blank field falls back to the default, so a template can never render an
// empty subject or body even if a row exists.
function mergeRow(def, row) {
  const pick = (val, fallback) => (val && String(val).trim() ? val : fallback);
  return {
    subject: pick(row && row.subject, def.defaults.subject),
    body: pick(row && row.body, def.defaults.body),
    replyTo: pick(row && row.reply_to, def.defaults.replyTo),
  };
}

export async function resolveTemplate(key) {
  const def = TEMPLATES[key];
  if (!def) throw new Error(`Unknown email template: ${key}`);
  let row = null;
  try { row = await getEmailTemplateRow(key); }
  catch (err) { console.error(`template read failed (${key}), using defaults:`, err.message); }
  return { key, ...mergeRow(def, row) };
}

// The live senders call this: resolve copy, substitute tokens, hand back everything Resend needs.
export async function renderTemplate(key, tokens = {}) {
  const t = await resolveTemplate(key);
  return renderFromValues(key, t, tokens);
}

// --- Admin listing + save ---

export async function listTemplatesForAdmin() {
  let rows = [];
  try { rows = await getAllEmailTemplateRows(); }
  catch (err) { console.error('template list read failed, showing defaults:', err.message); }
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  return Object.keys(TEMPLATES).map(key => {
    const def = TEMPLATES[key];
    const row = byKey[key] || null;
    const merged = mergeRow(def, row);
    return {
      key,
      label: def.label,
      description: def.description,
      tokens: def.tokens,
      from: fromAddrFor(key),
      ...merged,
      defaults: def.defaults,
      customized: !!row,
      updatedAt: row ? row.updated_at : null,
      updatedBy: row ? row.updated_by : '',
    };
  });
}

export async function saveTemplate(key, { subject, body, replyTo }, email) {
  if (!TEMPLATES[key]) throw new Error(`Unknown email template: ${key}`);
  return saveEmailTemplateRow(key, {
    subject: String(subject || '').trim(),
    body: String(body || ''),
    replyTo: String(replyTo || '').trim(),
  }, email);
}
