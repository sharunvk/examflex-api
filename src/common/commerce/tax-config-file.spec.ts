import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertWriteAllowed,
  describeCommerceDiff,
  parseSeedArgs,
  parseTaxSeed,
  seedFileName,
  validateTaxSeed,
} from '../../../scripts/commerce-seed/tax-config-file';

const examflex = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../scripts/commerce-seed/examflex.json'),
    'utf8',
  ),
) as Record<string, unknown>;

describe('tax config seed file', () => {
  it('selects the file for INSTANCE_ID', () => {
    expect(seedFileName('examflex')).toBe('examflex.json');
    expect(seedFileName('other')).toBe('other.json');
    expect(() => seedFileName('  ')).toThrow(/INSTANCE_ID is required/);
  });

  it('refuses a file whose instanceId does not match', () => {
    expect(() => parseTaxSeed(examflex, 'other')).toThrow(
      /does not match INSTANCE_ID "other"/,
    );
    expect(parseTaxSeed(examflex, 'examflex')).toMatchObject({
      instanceId: 'examflex',
      seller: { registeredAddress: 'Kerala, India', gstin: '32BIAPD6927L1ZC' },
    });
  });

  it.each([
    ['gstin length', { seller: { gstin: 'SHORT' } }, /15 characters/],
    [
      'unknown state',
      { seller: { stateCode: '25' } },
      /known Indian state code/,
    ],
    ['rate', { taxConfig: { taxRate: 18.5 } }, /integer from 0 to 100/],
    [
      'prefix',
      { taxConfig: { invoiceSeriesPrefix: 'ez-prep' } },
      /\[A-Z0-9\]\+/,
    ],
  ])('rejects %s', (_label, patch, pattern) => {
    const body = structuredClone(examflex) as Record<string, unknown>;
    const seller = {
      ...(body.seller as object),
      ...((patch as { seller?: object }).seller ?? {}),
    };
    const taxConfig = {
      ...(body.taxConfig as object),
      ...((patch as { taxConfig?: object }).taxConfig ?? {}),
    };
    const errors = validateTaxSeed({ ...body, seller, taxConfig });
    expect(errors.join('\n')).toMatch(pattern);
  });

  it('prints a field diff and leaves unchanged fields labeled', () => {
    const next = parseTaxSeed(examflex, 'examflex');
    const lines = describeCommerceDiff(
      {
        seller: {
          legalName: next.seller.legalName,
          registeredAddress: 'Kochi, Kerala',
          gstin: next.seller.gstin,
          state: next.seller.state,
          stateCode: next.seller.stateCode,
        },
        taxConfig: { ...next.taxConfig },
      },
      next,
    );
    expect(lines).toContain(
      'seller.registeredAddress: "Kochi, Kerala" -> "Kerala, India"',
    );
    expect(lines).toContain('seller.legalName: unchanged');
    expect(lines).toContain('taxConfig.taxRate: unchanged');
  });

  it('refuses a production write without --confirm-db', () => {
    expect(parseSeedArgs([])).toEqual({ apply: false, confirmDb: undefined });
    expect(parseSeedArgs(['--apply', '--confirm-db', 'examflex'])).toEqual({
      apply: true,
      confirmDb: 'examflex',
    });
    expect(() =>
      assertWriteAllowed({
        nodeEnv: 'production',
        apply: true,
        databaseName: 'examflex',
      }),
    ).toThrow(/without --confirm-db/);
    expect(() =>
      assertWriteAllowed({
        nodeEnv: 'production',
        apply: true,
        confirmDb: 'other',
        databaseName: 'examflex',
      }),
    ).toThrow(/does not match/);
    expect(() =>
      assertWriteAllowed({
        nodeEnv: 'development',
        apply: true,
        databaseName: 'examflex',
      }),
    ).not.toThrow();
  });
});
