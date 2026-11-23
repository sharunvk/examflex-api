# Mandatory onboarding (verified mobile + name + target exam)

Every student must finish one first-run step before anything else in the app
opens. Sign-in itself (Google and mobile OTP) is unchanged.

| Signed in with | Mobile | Name | Target exam |
| --- | --- | --- | --- |
| Mobile OTP | already verified by the login | asked (placeholder `User 1234` is blank) | asked |
| Google | verified with an OTP during onboarding | prefilled from Google, editable | asked |

Admins are never gated. Admin auth is untouched.

## State

On the `User` document:

- `phoneVerifiedAt`: when ownership of `phoneNumber` was proven with an OTP.
  Stamped by OTP sign-in (`StudentAccountResolver`) and by `POST /users/me/phone/verify`.
  A number without this stamp (for example one typed into the old profile form) is not trusted.
- `onboardingCompletedAt`: set by `POST /users/me/onboarding`.

Every user response carries three computed booleans: `phoneVerified`,
`onboardingCompleted` and `profileComplete` (= both; always `true` for admins).

## Enforcement

`JwtAuthGuard` itself rejects a student whose `profileComplete` is not `true`:

```
403 { "error": "PROFILE_INCOMPLETE", "message": "Complete your profile to continue." }
```

It fails closed: a missing flag counts as incomplete. New endpoints are gated
by default. A route opts out with `@AllowIncompleteProfile()`. Currently open:

- `GET /users/me`, `DELETE /users/me` (account deletion must always be possible)
- `GET /auth/profile`
- `POST /users/me/phone/verify`, `POST /users/me/onboarding`
- public routes such as `GET /exams/by-category` (no guard at all)

`src/onboarding/profile-gate-wiring.spec.ts` pins this list, so widening it is a
deliberate, reviewed change.

## Endpoints (`src/onboarding`)

- `POST /users/me/phone/verify` `{ accessToken }`: verifies the MSG91 widget token
  with MSG91 and attaches the number it reports. **The number is never taken from
  the client.** Outcomes:
  - same verified number already on the account: success (idempotent)
  - another account owns it: `409 PHONE_IN_USE` ("sign in with that number instead")
  - account already has a different verified number: `409 PHONE_ALREADY_SET`
  - bad/expired code: `400 OTP_VERIFICATION_FAILED` (deliberately not 401, which
    the web client treats as "session expired")
  - MSG91 unreachable: `503`
- `POST /users/me/onboarding` `{ name, targetExamId }`: needs a verified number
  (`403 PHONE_NOT_VERIFIED` otherwise), saves the name and exactly one target exam.

## Phone number is no longer editable

`PATCH /users/me` rejects `phoneNumber` (`forbidNonWhitelisted`). Previously any
signed-in user could save any number unverified, and phone sign-in finds accounts
by number, so that was an account-mix-up / squatting hole.

`phoneNumber` now has a **unique, partial index** (`phoneNumber_unique`), built by Mongoose
on boot. **Auto-indexing fails silently when duplicate numbers exist**, so the app would run
without the constraint. If you ever suspect that, check `db.users.getIndexes()` for
`phoneNumber_unique`, and look for duplicates with:

```
db.users.aggregate([
  { $match: { phoneNumber: { $type: "string" } } },
  { $group: { _id: "$phoneNumber", n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
])
```

The one-off migration that replaced the old non-unique `phoneNumber_1` index (and optionally
stamped OTP-created accounts as verified) has been run and removed.

Every existing student sees the onboarding screen once after the release (the API returns
403 `PROFILE_INCOMPLETE` for everything else until they finish). Admins are never gated.

### Other places that touch the number

- `PATCH /users/me` no longer accepts a new or different `email`: `400 EMAIL_VERIFICATION_REQUIRED` (re-sending the current email is ignored). Google sign-in links accounts by email, so an unproven address could capture someone else's Google sign-in. See "Email verification" below.
- The profile page shows the mobile and an existing real email as disabled fields.
- `PATCH /users/:id` (admin): changing the number removes `phoneVerifiedAt`. Re-saving the same number keeps it.
- Deleting an account removes `phoneVerifiedAt` and `onboardingCompletedAt` with the number; a restored account verifies and onboards again.
- `POST /users/me/onboarding` is first-run only: for a learner who already finished it changes nothing.

A first-time OTP sign-in that races another for the same number now signs the
loser into the winner's account instead of failing.

## Email verification (profile page)

Mobile-OTP learners add an email only by proving it with an email OTP. See
[EMAIL_VERIFICATION.md](EMAIL_VERIFICATION.md) for the design, API contract and
regression boundaries.

## Web (examflex-app)

- `components/auth/mobile-otp-form.tsx`: one themed OTP form used by login and
  onboarding. It drives the MSG91 widget in custom-UI mode (`exposeMethods: true`)
  through `lib/auth/otp-widget.ts`; MSG91 only sends and checks the code. hCaptcha is
  the one element MSG91 still draws (into our own container).
- `components/onboarding/profile-gate.tsx` wraps `app/(app)/layout.tsx`, so study and
  attempt pages are both covered. `onboarding-screen.tsx` is the screen it shows.
- OTP length (4), resend wait (60s) and resend count (2) come from the widget's own
  `getWidgetData()`; they are configured in the MSG91 dashboard.
