import { isPlaceholderEmail, placeholderEmailFor } from './placeholder-email';

describe('placeholder email', () => {
  it('is built from the digits of the phone number', () => {
    expect(placeholderEmailFor('+91 98765-43210')).toBe(
      'user919876543210@temp.examflex.com',
    );
  });

  it('recognises what it builds, in any case', () => {
    expect(isPlaceholderEmail(placeholderEmailFor('+919876543210'))).toBe(true);
    expect(isPlaceholderEmail('USER1@TEMP.EXAMFLEX.COM')).toBe(true);
  });

  it('does not mistake a real address for a placeholder', () => {
    expect(isPlaceholderEmail('asha@gmail.com')).toBe(false);
    expect(isPlaceholderEmail('asha@examflex.com')).toBe(false);
    expect(isPlaceholderEmail('x@temp.examflex.com.evil.com')).toBe(false);
    expect(isPlaceholderEmail('')).toBe(false);
    expect(isPlaceholderEmail(undefined)).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
  });
});
