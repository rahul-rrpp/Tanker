import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { getMockOtp } from '../src/modules/otp/providers/mock.provider';
import { api, uniqueEmail, uniquePhone } from './helpers';

const send = (destination: string, channel: 'SMS' | 'EMAIL' = 'SMS') =>
  api().post('/api/v1/auth/otp/send').send({ channel, destination, purpose: 'REGISTRATION' });
const verify = (destination: string, code: string, channel: 'SMS' | 'EMAIL' = 'SMS') =>
  api().post('/api/v1/auth/otp/verify').send({ channel, destination, purpose: 'REGISTRATION', code });

describe('OTP', () => {
  it('sends a 6-digit code, stores only a hash, and masks the destination', async () => {
    const phone = uniquePhone();
    const res = await send(phone);
    expect(res.status).toBe(200);
    expect(res.body.data.destination).toBe(`******${phone.slice(-4)}`);
    expect(res.body.data.expiresInSeconds).toBe(300);
    const code = getMockOtp(phone)!;
    expect(code).toMatch(/^\d{6}$/);
    const row = await prisma.oTPVerification.findFirstOrThrow({ where: { destination: phone } });
    expect(row.otpHash).not.toContain(code);
    expect(row.otpHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalises +91 numbers', async () => {
    const phone = uniquePhone();
    await send(`+91 ${phone}`).expect(200);
    expect(getMockOtp(phone)).toBeDefined();
  });

  it('supports email OTPs', async () => {
    const email = uniqueEmail();
    await send(email.toUpperCase(), 'EMAIL').expect(200);
    const res = await verify(email, getMockOtp(email)!, 'EMAIL');
    expect(res.status).toBe(200);
  });

  it('rejects an invalid code and reports remaining attempts', async () => {
    const phone = uniquePhone();
    await send(phone).expect(200);
    const wrong = getMockOtp(phone) === '000000' ? '111111' : '000000';
    const res = await verify(phone, wrong);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OTP');
    expect(res.body.error.details.attemptsRemaining).toBe(4);
  });

  it('locks the code after the maximum number of attempts', async () => {
    const phone = uniquePhone();
    await send(phone).expect(200);
    const code = getMockOtp(phone)!;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect((await verify(phone, wrong)).status).toBe(400);
    const fifth = await verify(phone, wrong);
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');
    // Even the correct code no longer works.
    expect((await verify(phone, code)).body.error.code).toBe('INVALID_OTP');
  });

  it('rejects an expired code', async () => {
    const phone = uniquePhone();
    await send(phone).expect(200);
    await prisma.oTPVerification.updateMany({ where: { destination: phone }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await verify(phone, getMockOtp(phone)!);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('prevents OTP reuse', async () => {
    const phone = uniquePhone();
    await send(phone).expect(200);
    const code = getMockOtp(phone)!;
    expect((await verify(phone, code)).status).toBe(200);
    const again = await verify(phone, code);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_OTP');
  });

  it('enforces the resend cooldown and invalidates the previous code on resend', async () => {
    const phone = uniquePhone();
    await send(phone).expect(200);
    const first = getMockOtp(phone)!;
    const tooSoon = await api().post('/api/v1/auth/otp/resend').send({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION' });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe('OTP_COOLDOWN');
    expect(Number(tooSoon.headers['retry-after'])).toBeGreaterThan(0);

    // Simulate the cooldown elapsing.
    await prisma.oTPVerification.updateMany({ where: { destination: phone }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await api().post('/api/v1/auth/otp/resend').send({ channel: 'SMS', destination: phone, purpose: 'REGISTRATION' }).expect(200);
    const second = getMockOtp(phone)!;
    if (first !== second) expect((await verify(phone, first)).status).toBe(400);
    expect((await verify(phone, second)).status).toBe(200);
  });

  it('validates destination format', async () => {
    const res = await send('12345');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
