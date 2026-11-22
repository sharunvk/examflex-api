/**
 * Mobile-OTP sign-ups have no email, but the schema requires one, so they get a
 * placeholder. It is never shown to the learner, and it does not count as
 * "having an email": they may add a real one once.
 */
const PLACEHOLDER_EMAIL_DOMAIN = 'temp.examflex.com';

export function placeholderEmailFor(phoneNumber: string): string {
  return `user${phoneNumber.replace(/\D/g, '')}@${PLACEHOLDER_EMAIL_DOMAIN}`;
}

export function isPlaceholderEmail(email: string | undefined | null): boolean {
  return (
    typeof email === 'string' &&
    email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`)
  );
}
