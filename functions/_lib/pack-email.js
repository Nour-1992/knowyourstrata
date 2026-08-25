/**
 * Transactional "here is your pack" email, sent once, right after a verified
 * purchase.
 *
 * Why this exists: access to a pack is a signed token, carried either by the
 * kys_access cookie or a ?t= link. Both are durable -- the cookie lasts a
 * decade and the token never expires -- but both live only in the browser the
 * buyer happened to check out in. Someone who clears cookies, switches
 * machines, or simply closes the tab without bookmarking has paid CAD $49 and
 * has no self-serve way back in. This email is the buyer's own durable copy,
 * and the thing they can search their inbox for a year from now.
 *
 * Deliberately plain HTML with inline styles: transactional mail has to render
 * in Outlook and in Gmail's clipped view, and nothing here is worth a layout
 * engine. There is a text/plain alternative because a HTML-only transactional
 * email is a spam signal.
 *
 * Requires RESEND_API_KEY (Cloudflare Pages -> Settings -> Environment
 * variables, added as a SECRET). The sending domain must be verified in
 * Resend first or every send returns 403.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const PACKS = {
  bc: {
    name: 'BC Strata Board Starter Pack',
    statute: 'Strata Property Act',
    contents: [
      'The Compliance Calendar — every recurring deadline, cited',
      'Four checklists: calling an AGM, running a special levy, answering a records request, enforcing a bylaw fine',
      'Four templates, including a levy resolution built around the s. 108(3) requirements',
      'A new-treasurer orientation guide',
      'An insurance deductible reference, with the case law'
    ]
  },
  on: {
    name: 'Ontario Condo Board Starter Pack',
    statute: 'Condominium Act, 1998',
    contents: [
      'The Compliance Calendar — every recurring deadline, cited',
      'Checklists for calling a meeting, responding to a records request, and enforcement',
      'Templates you can adapt, each tied to the section it comes from',
      'A new board member orientation guide'
    ]
  }
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildHtml(pack, link) {
  const items = pack.contents
    .map((c) => `<li style="margin:0 0 6px">${escapeHtml(c)}</li>`)
    .join('');
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#F1F0EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#161A18;line-height:1.6">
  <div style="max-width:560px;margin:0 auto;background:#FBFAF8;border:1px solid #DBD9D2;border-radius:10px;padding:28px 26px">

    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8B948F">Know Your Strata</p>
    <h1 style="margin:0 0 18px;font-size:21px;line-height:1.25;font-weight:600;color:#1D3A31">Your ${escapeHtml(pack.name)}</h1>

    <p style="margin:0 0 18px;font-size:15px;color:#5C6763">Thanks for buying the pack. Here is your permanent link — <strong style="color:#161A18">save this email</strong>, it is how you get back in.</p>

    <p style="margin:0 0 20px">
      <a href="${safeLink}" style="display:inline-block;background:#1D3A31;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:6px">Open your pack</a>
    </p>

    <p style="margin:0 0 22px;font-size:12px;color:#8B948F;word-break:break-all">Or paste this into your browser:<br><span style="color:#5C6763">${safeLink}</span></p>

    <div style="border-top:1px solid #DBD9D2;padding-top:18px;margin-bottom:18px">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#161A18">What is in it</p>
      <ul style="margin:0;padding-left:20px;font-size:14px;color:#5C6763">${items}</ul>
    </div>

    <div style="background:#F1F0EC;border-left:3px solid #1D3A31;padding:12px 14px;margin-bottom:18px">
      <p style="margin:0;font-size:13px;color:#5C6763"><strong style="color:#161A18">No login, no expiry.</strong> The link works on any device and does not run out. The pack is reviewed against the ${escapeHtml(pack.statute)} weekly, so this link always shows the current edition — not the version as it stood the day you bought it.</p>
    </div>

    <p style="margin:0 0 6px;font-size:13px;color:#5C6763">Lost the link later? Just reply to this email and I will re-send it.</p>
    <p style="margin:0;font-size:13px;color:#8B948F">Your payment receipt comes separately from Stripe.</p>

  </div>
  <p style="max-width:560px;margin:14px auto 0;font-size:11px;color:#8B948F;text-align:center">Know Your Strata · General information, not legal advice.</p>
</body></html>`;
}

function buildText(pack, link) {
  return [
    `Your ${pack.name}`,
    '',
    'Thanks for buying the pack. Here is your permanent link -- save this email,',
    'it is how you get back in.',
    '',
    link,
    '',
    'What is in it:',
    ...pack.contents.map((c) => `  - ${c}`),
    '',
    'No login, no expiry. The link works on any device and does not run out.',
    `The pack is reviewed against the ${pack.statute} weekly, so this link always`,
    'shows the current edition -- not the version as it stood the day you bought it.',
    '',
    'Lost the link later? Just reply to this email and I will re-send it.',
    'Your payment receipt comes separately from Stripe.',
    '',
    'Know Your Strata -- general information, not legal advice.'
  ].join('\n');
}

/**
 * Sends the pack email. Never throws: a delivery failure must not affect a
 * purchase that already succeeded, and the buyer is being redirected into the
 * pack regardless. Returns { ok, error } so the caller can log the reason.
 */
export async function sendPackEmail({ apiKey, from, replyTo, to, product, link }) {
  const pack = PACKS[product];
  if (!apiKey) return { ok: false, error: 'no_api_key' };
  if (!pack) return { ok: false, error: 'unknown_product' };
  if (!to || typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, error: 'no_recipient' };
  }

  const body = {
    from,
    to: [to],
    subject: `Your ${pack.name} — your access link inside`,
    html: buildHtml(pack, link),
    text: buildText(pack, link)
  };
  if (replyTo) body.reply_to = replyTo;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (res.ok) return { ok: true };
    // Read a bounded amount: an error body can be large and is only ever logged.
    const detail = await res.text().catch(() => '');
    return { ok: false, error: `resend_${res.status}`, detail: detail.slice(0, 300) };
  } catch (err) {
    return { ok: false, error: 'fetch_failed', detail: String(err).slice(0, 200) };
  }
}
