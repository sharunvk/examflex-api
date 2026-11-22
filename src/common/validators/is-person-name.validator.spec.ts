import { ValidationArguments } from 'class-validator';
import {
  IsPersonName,
  IsPersonNameConstraint,
} from './is-person-name.validator';

// The alphabet itself is covered exhaustively in common/person-name.spec.ts;
// this checks the class-validator wiring.
describe('IsPersonNameConstraint', () => {
  const constraint = new IsPersonNameConstraint();
  const args = {} as ValidationArguments;

  it('lets empty values through for other validators to judge', () => {
    expect(constraint.validate('', args)).toBe(true);
    expect(constraint.validate(undefined, args)).toBe(true);
    expect(constraint.validate(null, args)).toBe(true);
  });

  it('accepts real names and rejects hostile ones', () => {
    expect(constraint.validate('Rahul K.', args)).toBe(true);
    expect(constraint.validate('Jos\u00e9 Garc\u00eda', args)).toBe(true);
    expect(constraint.validate('<script>alert(1)</script>', args)).toBe(false);
    expect(constraint.validate('Rahul`id`', args)).toBe(false);
    expect(constraint.validate('=1+1', args)).toBe(false);
    expect(constraint.validate('www.evil.com', args)).toBe(false);
    expect(constraint.validate(42, args)).toBe(false);
  });

  it('has a readable default message', () => {
    expect(constraint.defaultMessage()).toMatch(/valid name/i);
  });

  it('registers as a decorator', () => {
    class Sample {
      @IsPersonName()
      name!: string;
    }
    expect(new Sample()).toBeDefined();
  });
});
