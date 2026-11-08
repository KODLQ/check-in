// Verifies Svix-style webhook signatures as used by Resend:
//   svix-id, svix-timestamp, svix-signature: "v1,<base64 hmac>" (space-separated list)
//   signed content = `${id}.${timestamp}.${rawBody}`, key = base64-decoded secret after "whsec_".
const TOLERANCE_SECONDS = 5 * 60;

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function signWebhook(secret: string, id: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    b64decode(secret.replace(/^whsec_/, '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${b64encode(new Uint8Array(sig))}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhook(
  secret: string,
  headers: Headers,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const id = headers.get('svix-id');
  const ts = Number(headers.get('svix-timestamp'));
  const given = headers.get('svix-signature');
  if (!id || !Number.isFinite(ts) || !given) return false;
  if (Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  const expected = await signWebhook(secret, id, ts, body);
  return given.split(' ').some((s) => constantTimeEqual(s, expected));
}
