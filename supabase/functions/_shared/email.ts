// Email transports for the notifications worker (design §9).
//  - "resend": production. Resend with the sending domain in the EU region (eu-west-1). The region is a
//    property of the verified domain in Resend, not of the API call. Open/click tracking must be disabled
//    on the domain. Idempotency-Key = delivery id, so a retried send after a crash is not delivered twice.
//  - "smtp": local development against Mailpit (supabase local_smtp). Plain SMTP, no auth/TLS.
// Chosen with EMAIL_TRANSPORT.

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  /** Stable per delivery: provider idempotency key / Message-ID. */
  idempotencyKey: string;
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; temporary: boolean; error: string };

export interface EmailTransport {
  name: string;
  send(msg: OutgoingEmail): Promise<SendResult>;
}

/** Maps an HTTP status from an email/push provider to retry semantics. */
export function classifyHttpStatus(status: number): 'ok' | 'temporary' | 'permanent' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 408 || status === 409 || status === 429 || status >= 500) return 'temporary';
  return 'permanent';
}

export function resendTransport(opts: { apiKey: string; fetch?: typeof fetch; baseUrl?: string }): EmailTransport {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? 'https://api.resend.com';
  return {
    name: 'resend',
    async send(msg) {
      const res = await doFetch(`${baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': msg.idempotencyKey,
        },
        body: JSON.stringify({
          from: msg.from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          headers: msg.headers,
        }),
      });
      const kind = classifyHttpStatus(res.status);
      const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string };
      if (kind === 'ok') return { ok: true, id: body.id ?? msg.idempotencyKey };
      return { ok: false, temporary: kind === 'temporary', error: `resend_${res.status}${body.name ? `_${body.name}` : ''}` };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Minimal SMTP client (RFC 5321) for Mailpit. Not for production use: no TLS, no AUTH.

function encodeHeader(value: string): string {
  // RFC 2047 encoded-word for non-ASCII header values (e.g. Swedish subjects).
  // deno-lint-ignore no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

function base64Lines(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return (btoa(bin).match(/.{1,76}/g) ?? []).join('\r\n');
}

export function buildMime(msg: OutgoingEmail, messageId: string, date = new Date()): string {
  const boundary = `b_${messageId.replace(/[^A-Za-z0-9]/g, '')}`;
  const headers: Record<string, string> = {
    From: msg.from,
    To: msg.to,
    Subject: encodeHeader(msg.subject),
    Date: date.toUTCString(),
    'Message-ID': `<${messageId}>`,
    'MIME-Version': '1.0',
    'Content-Type': `multipart/alternative; boundary="${boundary}"`,
    ...msg.headers,
  };
  return [
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(msg.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(msg.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

function addressOf(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from;
}

export function smtpTransport(opts: { host: string; port: number; heloName?: string }): EmailTransport {
  return {
    name: 'smtp',
    async send(msg) {
      const messageId = `${msg.idempotencyKey}@check-in.local`;
      let conn: Deno.Conn;
      try {
        conn = await Deno.connect({ hostname: opts.host, port: opts.port });
      } catch (e) {
        return { ok: false, temporary: true, error: `smtp_connect_${(e as Error).name}` };
      }
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      let buffer = '';
      const readReply = async (): Promise<number> => {
        const chunk = new Uint8Array(4096);
        while (true) {
          const lines = buffer.split('\r\n');
          // A complete reply ends with a line "NNN text" (space, not dash, after the code).
          const done = lines.slice(0, -1).find((l) => /^\d{3} /.test(l));
          if (done) {
            buffer = '';
            return Number(done.slice(0, 3));
          }
          const n = await conn.read(chunk);
          if (n === null) throw new Error('smtp_closed');
          buffer += dec.decode(chunk.subarray(0, n));
        }
      };
      const cmd = async (line: string, expect: number[]) => {
        await conn.write(enc.encode(`${line}\r\n`));
        const code = await readReply();
        if (!expect.includes(code)) throw Object.assign(new Error(`smtp_${code}`), { code });
      };
      try {
        const greet = await readReply();
        if (greet !== 220) throw Object.assign(new Error(`smtp_${greet}`), { code: greet });
        await cmd(`EHLO ${opts.heloName ?? 'check-in.local'}`, [250]);
        await cmd(`MAIL FROM:<${addressOf(msg.from)}>`, [250]);
        await cmd(`RCPT TO:<${msg.to}>`, [250, 251]);
        await cmd('DATA', [354]);
        const data = buildMime(msg, messageId).replace(/\r\n\./g, '\r\n..');
        await cmd(`${data}\r\n.`, [250]);
        await conn.write(enc.encode('QUIT\r\n')).catch(() => 0);
        return { ok: true, id: messageId };
      } catch (e) {
        const code = (e as { code?: number }).code;
        return { ok: false, temporary: !code || code < 500, error: (e as Error).message.slice(0, 100) };
      } finally {
        try {
          conn.close();
        } catch {
          // already closed
        }
      }
    },
  };
}

export function emailTransportFromEnv(env: { get(name: string): string | undefined }): EmailTransport {
  const kind = env.get('EMAIL_TRANSPORT') ?? 'smtp';
  if (kind === 'resend') {
    const apiKey = env.get('RESEND_API_KEY');
    if (!apiKey) throw new Error('RESEND_API_KEY is not set');
    return resendTransport({ apiKey });
  }
  return smtpTransport({
    host: env.get('SMTP_HOST') ?? 'inbucket',
    port: Number(env.get('SMTP_PORT') ?? '1025'),
  });
}
