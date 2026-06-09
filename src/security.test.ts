import { describe, it, expect } from 'vitest';
import { validateDomain, createResponseValidator } from './security.js';

describe('validateDomain', () => {
  it('allows the sippar.network relay host', () => {
    expect(validateDomain('https://sippar.network/api/sippar/cross-chain/pay').valid).toBe(true);
  });

  it('allows sippar.network subdomains', () => {
    expect(validateDomain('https://api.sippar.network/x').valid).toBe(true);
  });

  it('rejects non-HTTPS', () => {
    const r = validateDomain('http://sippar.network/pay');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/HTTPS/);
  });

  it('rejects off-allowlist domains', () => {
    const r = validateDomain('https://evil.example.com/pay');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/not in allowed list/);
  });

  it('does not allow a look-alike suffix domain', () => {
    // "sippar.network.evil.com" must NOT match "sippar.network"
    expect(validateDomain('https://sippar.network.evil.com/pay').valid).toBe(false);
  });

  it('blocks private IPs even over HTTPS', () => {
    expect(validateDomain('https://127.0.0.1/pay').valid).toBe(false);
    expect(validateDomain('https://10.0.0.5/pay').valid).toBe(false);
    expect(validateDomain('https://192.168.1.1/pay').valid).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(validateDomain('not a url').valid).toBe(false);
  });
});

describe('createResponseValidator', () => {
  const validate = createResponseValidator(1000);

  it('passes responses under the size cap', () => {
    const res = new Response('ok', { headers: { 'content-length': '500' } });
    expect(validate(res).valid).toBe(true);
  });

  it('rejects responses over the size cap', () => {
    const res = new Response('big', { headers: { 'content-length': '5000' } });
    expect(validate(res).valid).toBe(false);
  });

  it('passes when content-length is absent', () => {
    const res = new Response('ok');
    expect(validate(res).valid).toBe(true);
  });
});
