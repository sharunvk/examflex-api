/**
 * Machine-readable `details.code` on attempt start/resume errors.
 * Clients use these to tell that their copy of a paper's attempt state is
 * stale (for example a card still offering Resume) and to reload it.
 */
export enum AttemptErrorCode {
  /** The attempt ran out of time and has been scored as EXPIRED. */
  ATTEMPT_EXPIRED = 'ATTEMPT_EXPIRED',
  /** The attempt was already submitted, so it cannot be resumed. */
  ATTEMPT_CLOSED = 'ATTEMPT_CLOSED',
  /** The paper already has an IN_PROGRESS or PAUSED attempt; resume it instead. */
  ATTEMPT_ALREADY_ACTIVE = 'ATTEMPT_ALREADY_ACTIVE',
  /** The paper does not allow retakes and was already attempted. */
  RETAKE_NOT_ALLOWED = 'RETAKE_NOT_ALLOWED',
}
