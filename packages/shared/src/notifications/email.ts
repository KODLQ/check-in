/** Plain-text + simple inline-styled HTML email. No images, no tracking pixels. */

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** RFC 2369 + RFC 8058 one-click unsubscribe headers. */
export function unsubscribeHeaders(oneClickUrl: string, mailto?: string | null): Record<string, string> {
  const targets = [`<${oneClickUrl}>`];
  if (mailto) targets.push(`<${mailto}>`);
  return {
    'List-Unsubscribe': targets.join(', '),
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export function renderEmailLayout(opts: {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta: { label: string; url: string } | null;
  footer: string;
  unsubscribeLabel: string;
  unsubscribeUrl: string;
  oneClickUrl: string;
  unsubscribeMailto: string | null;
  lang: string;
}): EmailMessage {
  const text = [
    opts.heading,
    '',
    ...opts.paragraphs.flatMap((p) => [p, '']),
    ...(opts.cta ? [`${opts.cta.label}: ${opts.cta.url}`, ''] : []),
    '--',
    opts.footer,
    `${opts.unsubscribeLabel}: ${opts.unsubscribeUrl}`,
    '',
  ].join('\n');

  const p = (s: string) =>
    `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#111114;white-space:pre-wrap">${escapeHtml(s)}</p>`;
  const html = `<!doctype html>
<html lang="${escapeHtml(opts.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border-radius:16px;padding:24px">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#111114">${escapeHtml(opts.heading)}</h1>
${opts.paragraphs.map(p).join('\n')}
${opts.cta ? `<p style="margin:20px 0 0"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:#ff4d6d;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px">${escapeHtml(opts.cta.label)}</a></p>` : ''}
</div>
<p style="margin:16px 8px 0;font-size:13px;line-height:1.5;color:#6b6b76">${escapeHtml(opts.footer)}<br><a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#6b6b76">${escapeHtml(opts.unsubscribeLabel)}</a></p>
</div>
</body></html>
`;
  return {
    subject: opts.subject,
    text,
    html,
    headers: unsubscribeHeaders(opts.oneClickUrl, opts.unsubscribeMailto),
  };
}
