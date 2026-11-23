# Email verification (profile page)

Learners who signed up with a mobile OTP can add an email address on `/profile`.
The address is attached only after they prove they own it, by entering a code
emailed to them. This document covers why the feature exists, how it works end to
end, the API contract, and what it deliberately does not touch.

Repos: `examflex-api` (this repo) and `examflex-app`.

## Why

Mobile-OTP sign-ups have no email. The schema requires one, so they get a
placeholder: `user<digits>@temp.examflex.com` (`src/users/placeholder-email.ts`). It
is never shown, and it does not count as "having an email".

Before this change, `PATCH /users/me` let such a learner set any address with no
proof. That is an account-linking hole. **Google sign-in links accounts by email**
(`StudentAccountResolver.resolveGoogle` → `findAuthByEmail` →
`attachGoogleToExisting`). A learner who typed someone else's Gmail would capture
that person's next Google sign-in into the wrong account.

Now an email can only be added by proving it, and the API, not the client, decides
which address was proven.

## Scope

| Who | What changes |
| --- | --- |
| Mobile-OTP learner with no email or only the placeholder | Adds an email on `/profile` through the email OTP. This is the only path. |
| Learner with a real email (Google, or added earlier) | Nothing. The email stays locked on `/profile`, as before. |
| Google sign-in | Nothing. Same resolver, same linking and email sync. |
| Mobile OTP sign-in and onboarding | Nothing visible. Same widget, same SMS flow. See [Regression boundaries](#regression-boundaries). |
| Admin user edits (`PATCH /users/:id`) | Nothing. |

Email OTP is **not** a sign-in method. There is no email login.

## How it works

```
Browser (/profile)                     MSG91                         examflex-api
──────────────────                     ─────                         ────────────
type email → Verify
  dialog opens, widget starts
  learner ticks the human check
  sendOtp("riya@example.com") ───────▶ emails the code
  learner enters the code
  verifyOtp(code) ───────────────────▶ returns an access token
  POST /users/me/email/verify { accessToken } ─────────────────────▶
                                                     verifyAccessToken(token) ──▶ MSG91
                                                     ◀── verified identifier (the email)
                                                     check it is an email, lowercase it
                                                     setVerifiedEmail(user, email)
  ◀──────────────────────────────────────────────── 200 { data: profile (emailVerified: true) }
  field locks with a "Verified" badge
```

The address the browser typed is used only to send the code. The address that gets
saved is the one **MSG91 reports** for the token. A client cannot verify one address
and save another.

### MSG91

- The existing OTP widget (the one used for phone login and onboarding) has the
  **Email** contact point enabled, and the sending domain is verified in the MSG91
  dashboard. No new widget id or keys.
- DLT does not apply to email.
- The web app uses the widget in custom-UI mode (`exposeMethods: true`). The email is
  passed to `sendOtp` as-is (phones use `91XXXXXXXXXX`).
- Resend uses the widget's default channel (`retryOtp(null)`). If MSG91 ever resends
  an email code by SMS, pass `EMAIL_RETRY_CHANNEL` (`"3"`, in
  `examflex-app/lib/auth/otp-widget.ts`) from the dialog instead.

## API

### `POST /api/v1/users/me/email/verify`

- Auth: JWT. Behind the onboarding gate: unlike `phone/verify` and `onboarding`, it
  is **not** `@AllowIncompleteProfile`, because it is a profile-page action.
- Throttle: 10 requests per minute.
- Body: `{ "accessToken": "<token from the MSG91 widget>" }` (`VerifyEmailDto`, max
  4096 characters).
- Response: `200 { message: "Email verified", data: UserResponseDto }`.

| Case | Result |
| --- | --- |
| Account has no email, or only the placeholder | Email set, `emailVerifiedAt` stamped |
| The same real address again (any case) | Stamped again, no change |
| A different real email is already on the account | `409 EMAIL_ALREADY_SET` |
| Another account owns the address | `409 EMAIL_IN_USE` (the unique index on `email` also covers two requests racing; a duplicate-key error maps to the same code) |
| Token invalid or expired, or it verified a phone number | `400 OTP_VERIFICATION_FAILED`. Never 401: the web client treats 401 as an expired session. |
| MSG91 unreachable or erroring | `503` |
| Account deleted or deactivated | `404` |

Code path: `OnboardingController.verifyEmail` → `OnboardingService.verifyEmail` →
`Msg91Service.verifyEmailAccessToken` → `UsersService.setVerifiedEmail`.

### `PATCH /api/v1/users/me`

- A **new or different** `email` → `400 EMAIL_VERIFICATION_REQUIRED` ("Verify your
  email with a code to add it."). Nothing is written, including the other fields in
  that request.
- The account's **current real email**, re-sent unchanged (any case, surrounding
  spaces), is accepted and ignored. This keeps clients that always post the whole
  form working.
- `email` stays on `UpdateMeDto` (marked deprecated in Swagger) so old clients get
  this clear error, not a validation error.

### `Msg91Service`

Both verification methods share `fetchVerifiedIdentifier`, which calls
`/api/v5/widget/verifyAccessToken` and picks the identifier from the reply:

1. On `type: "success"`: `data.mobile`, then `data.email`, `data.identifier`,
   `message`.
2. Otherwise: top-level `mobile`, then `email`.
3. A non-JSON body is the identifier itself.

`message` only counts on a success reply, so an error message is never read as an
identifier.

| Method | Accepts | Rejects (401) |
| --- | --- | --- |
| `verifyAccessToken` (phone login, onboarding) | 10+ characters, no `@`; returned with a leading `+` | Anything containing `@` (an email token can never become `+you@example.com`) |
| `verifyEmailAccessToken` (this feature) | A valid email; returned trimmed and lowercased | Anything that is not an email |

The raw MSG91 reply is logged (`MSG91 API raw response: …`), as it was for phones.
It now includes email addresses, so treat those logs as personal data.

### Data model

`User.emailVerifiedAt?: Date`: when the email was proven with an OTP. No migration;
existing documents simply do not have it.

Responses expose a computed `emailVerified: boolean` (the raw timestamp is removed):

```
emailVerified = email is a real address (not the placeholder)
             && (emailVerifiedAt is set || a Google account is linked)
```

Google-linked accounts count as verified because Google only shares addresses with
`email_verified: true` (`google-identity.strategy.ts`). This covers every existing
Google user without a migration.

Real emails added through the old unverified `PATCH` stay as they are: locked, with
`emailVerified: false`.

## Web app (examflex-app)

| File | Role |
| --- | --- |
| `components/profile/profile-contact-form.tsx` | Email field states (below). |
| `components/profile/email-verify-dialog.tsx` | The verification dialog. Mounted only while open, because the widget starts on mount. |
| `components/profile/profile-view.tsx` | Opens the dialog, applies the returned profile, shows "Email verified." |
| `hooks/use-otp-verification.ts` | The shared MSG91 flow: load and start the widget, fit the human check, send / verify / resend with a countdown, retry a verified token. Used by the phone form and the email dialog. |
| `components/auth/otp-captcha-box.tsx`, `lib/auth/otp-theme.ts` | Shared captcha container and theme classes. |
| `lib/api/onboarding.ts` → `verifyMyEmail` | `POST /users/me/email/verify`. |
| `lib/profile/validate.ts` → `emailVerifyError` | Empty or implausible email, checked before opening the dialog. |

### Email field states

| State | Shown |
| --- | --- |
| No email or placeholder | Editable input, a **Verify** button (disabled while empty), and the hint "We'll email you a code to confirm it's yours." Enter in the field also starts verification and never submits the form. |
| Real and verified | Disabled input and a green **Verified** badge. Google users see this too, since their email is verified. |
| Real, not verified (added before this change) | Disabled input, no badge (as before). |

**Save details** covers the name only. A typed, unverified email does not enable
Save, is never sent by it, and is kept in the field when the name is saved. After
verification, an unsaved name edit is kept too.

### Dialog

It uses `AttemptModal` (focus trap, Escape, focus returns to the Verify button), in
the study theme.

1. **Start**: the address ("Sending to"), the human check, **Send code**, and **Use
   a different email** (closes the dialog).
2. **Code**: "Enter the N-digit code", "Sent to … · Change email", the digit boxes
   (it verifies itself on the last digit), the resend countdown, and a spam-folder
   hint.
3. **Finishing**: "Saving your email…". The dialog cannot be closed in this state.

Failures:

- A wrong code clears the boxes and shows the reason.
- A network error or 5xx keeps the verified token and offers **Try again** without a
  new code.
- Any other API error (in use, already set, expired) goes back to the start with the
  API's message and a fresh human check.

## Regression boundaries

What was checked so that existing flows stay the same:

- **Google sign-in**: `StudentAccountResolver`, `GoogleIdentityStrategy`,
  `createGoogleUser`, `linkGoogleAccount` and `updateEmailIfAvailable` are
  unchanged. The only difference is the extra `emailVerified` field in the response.
- **Mobile OTP sign-in and onboarding phone verification**: `verifyAccessToken`
  reads the identifier in the same order as before. The one new rule is rejecting
  identifiers that contain `@`. On the web, `MobileOtpForm` now runs on the shared
  hook with the same markup, copy, captcha id (`msg91-captcha`), identifier format
  and resend channel. All of its existing tests pass unchanged.
- **Onboarding gate**: `@AllowIncompleteProfile` moved from the
  `OnboardingController` class onto `phone/verify` and `onboarding`, so those two stay
  open exactly as before (`profile-gate-wiring.spec.ts`).
- **Profile name and target-exam saves**: same `PATCH /users/me`. Re-sending the
  current email is still accepted.
- **Copy**: the widget's rare "not ready" errors now say "Verification is not ready."
  instead of "Phone verification is not ready.", because the helper is shared.

## Tests

- API: `msg91.service.spec.ts` (reply shapes, phone path rejects emails),
  `users.onboarding.spec.ts` (`setVerifiedEmail`, `PATCH` rules, `emailVerified`),
  `onboarding.service.spec.ts` (error mapping), `profile-gate-wiring.spec.ts` (route
  stays gated).
- Web: `email-verify-dialog.test.tsx`, `profile-view.test.tsx`,
  `lib/api/onboarding.test.ts`, `lib/api/users.test.ts`,
  `lib/profile/*.test.ts`, `lib/auth/otp-widget.test.ts`, and the unchanged
  `mobile-otp-form.test.tsx`.

### Manual check

As a mobile-OTP learner on `/profile`:

1. Add an email, verify it, and confirm the field locks with the badge.
2. Check `GET /users/me` returns `emailVerified: true`.
3. Try a wrong code, a resend, and an address that another account owns.
4. Confirm phone login, onboarding and Google sign-in still work.
