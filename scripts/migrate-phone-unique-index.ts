/**
 * One-off migration for the mandatory-onboarding release.
 *
 *   npm run users:migrate-phone-index                       # dry run: reads only, changes nothing
 *   npm run users:migrate-phone-index -- --apply            # unique phone index
 *   npm run users:migrate-phone-index -- --apply --stamp-otp-phones
 *
 * What it does
 *  1. Makes sure `users.phoneNumber` has the unique, partial index
 *     `phoneNumber_unique` (created FIRST), then drops the old non-unique
 *     `phoneNumber_1`. Refuses to touch anything while duplicate numbers exist,
 *     because Mongoose's auto-indexing fails silently on duplicates and the app
 *     would otherwise run without the constraint.
 *  2. With --stamp-otp-phones (needs --apply), stamps `phoneVerifiedAt` on
 *     accounts that were created by mobile-OTP sign-in (placeholder
 *     @temp.examflex.com email, no Google link). They proved that number when
 *     they signed in, so they are not asked to verify it again. Every learner
 *     still completes name + target exam on first run.
 *
 * Safe to run more than once. The database URI is never printed.
 */
import { config } from 'dotenv';
import mongoose from 'mongoose';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env') });

const OLD_INDEX = 'phoneNumber_1';
const NEW_INDEX = 'phoneNumber_unique';
const NEW_INDEX_SPEC = {
  name: NEW_INDEX,
  unique: true,
  partialFilterExpression: { phoneNumber: { $type: 'string' } },
};

/** Accounts made by OTP sign-in: placeholder email, no Google link, number present, not yet stamped. */
const OTP_CREATED_UNSTAMPED = {
  role: { $ne: 'admin' },
  isDeleted: { $ne: true },
  phoneNumber: { $type: 'string' },
  phoneVerifiedAt: { $exists: false },
  googleSub: { $exists: false },
  email: { $regex: '@temp\\.examflex\\.com$', $options: 'i' },
};

const mask = (phone: string) =>
  phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const stamp = process.argv.includes('--stamp-otp-phones');
  if (stamp && !apply) {
    throw new Error('--stamp-otp-phones only works together with --apply');
  }

  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(uri);
  let exitCode = 0;
  try {
    const databaseName = mongoose.connection.db?.databaseName;
    if (!databaseName) {
      throw new Error('Could not read the database name from MONGODB_URI');
    }
    const users = mongoose.connection.collection('users');

    // ── Duplicates (block everything) ────────────────────────────────────────
    const exactDuplicates = await users
      .aggregate<{ _id: string; count: number; ids: unknown[] }>([
        { $match: { phoneNumber: { $type: 'string' } } },
        {
          $group: {
            _id: '$phoneNumber',
            count: { $sum: 1 },
            ids: { $push: '$_id' },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    // Same person, different formatting (+91 98..., 98..., 9198...). Not a
    // unique-index violation, so informational only.
    const lookalikes = await users
      .aggregate<{ _id: string; count: number }>([
        { $match: { phoneNumber: { $type: 'string' } } },
        {
          $group: {
            // last 10 characters; $max keeps the start index valid for short legacy values
            _id: {
              $substrCP: [
                '$phoneNumber',
                { $max: [0, { $subtract: [{ $strLenCP: '$phoneNumber' }, 10] }] },
                10,
              ],
            },
            numbers: { $addToSet: '$phoneNumber' },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $match: { $expr: { $gt: [{ $size: '$numbers' }, 1] } } },
      ])
      .toArray();

    // ── Index state ──────────────────────────────────────────────────────────
    const indexes = await users.indexes();
    const oldIndex = indexes.find(index => index.name === OLD_INDEX);
    const newIndex = indexes.find(index => index.name === NEW_INDEX);
    const newIndexIsRight = Boolean(
      newIndex?.unique && newIndex.partialFilterExpression,
    );

    const actions: string[] = [];
    let blocked: string | null = null;
    if (exactDuplicates.length > 0) {
      blocked = 'duplicate phone numbers exist; resolve them first';
    } else if (newIndex && !newIndexIsRight) {
      blocked = `${NEW_INDEX} exists with unexpected options; drop it manually and re-run`;
    } else {
      if (!newIndex) actions.push(`create ${NEW_INDEX}`);
      if (oldIndex) actions.push(`drop ${OLD_INDEX}`);
    }

    // ── Stamp OTP-created accounts ───────────────────────────────────────────
    const toStamp = await users.countDocuments(OTP_CREATED_UNSTAMPED);
    const totalWithoutStamp = await users.countDocuments({
      role: { $ne: 'admin' },
      isDeleted: { $ne: true },
      phoneVerifiedAt: { $exists: false },
    });

    let created = false;
    let dropped = false;
    let stamped = 0;
    if (apply && !blocked) {
      if (!newIndex) {
        await users.createIndex({ phoneNumber: 1 }, NEW_INDEX_SPEC);
        created = true;
      }
      if (oldIndex) {
        await users.dropIndex(OLD_INDEX);
        dropped = true;
      }
    }
    if (apply && stamp) {
      const result = await users.updateMany(OTP_CREATED_UNSTAMPED, [
        { $set: { phoneVerifiedAt: { $ifNull: ['$createdAt', '$$NOW'] } } },
      ]);
      stamped = result.modifiedCount;
    }

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          database: databaseName,
          indexesBefore: indexes.map(index => index.name),
          duplicatePhoneNumbers: exactDuplicates.map(d => ({
            number: mask(d._id),
            accounts: d.ids.map(String),
          })),
          formattingLookalikes: lookalikes.length,
          indexPlan: blocked ? [`BLOCKED: ${blocked}`] : actions,
          indexResult: apply ? { created, dropped } : undefined,
          studentsWithoutVerifiedStamp: totalWithoutStamp,
          otpCreatedAccountsStampable: toStamp,
          stampResult: apply && stamp ? { stamped } : undefined,
          note:
            !stamp && toStamp > 0
              ? `${toStamp} OTP-created account(s) would be asked to verify their number again; add --stamp-otp-phones (with --apply) to skip that.`
              : undefined,
        },
        null,
        2,
      ),
    );

    if (blocked) exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
  process.exitCode = exitCode;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
