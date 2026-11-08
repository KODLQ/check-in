import { describe, expect, it } from 'vitest';
import { displayInviteUrl, inviteUrl } from './invite';

describe('displayInviteUrl', () => {
  it('drops the https scheme', () => {
    expect(displayInviteUrl('https://checkin.example', 'AbC123def456')).toBe('checkin.example/i/AbC123def456');
  });
  it('drops the http scheme and keeps the port', () => {
    expect(displayInviteUrl('http://localhost:3000', 'AbC123def456')).toBe('localhost:3000/i/AbC123def456');
  });
  it('ignores trailing slashes on the base URL', () => {
    expect(displayInviteUrl('https://checkin.example/', 'AbC123def456')).toBe('checkin.example/i/AbC123def456');
    expect(displayInviteUrl('https://checkin.example//', 'AbC123def456')).toBe('checkin.example/i/AbC123def456');
  });
  it('is the invite URL without its scheme', () => {
    const base = 'HTTPS://Checkin.example';
    expect(`https://${displayInviteUrl(base, 'x')}`).toBe(inviteUrl(base, 'x').replace(/^HTTPS/, 'https'));
  });
});
