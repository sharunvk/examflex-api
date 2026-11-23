import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { isValidPersonName } from '../person-name';

/**
 * Letters of any script, digits, spaces and . , ' - ( ). Rejects markup and code
 * characters, emoji, invisible / control / bidi characters, names that look like
 * links and names that do not start with a letter or digit. See common/person-name.ts.
 */
@ValidatorConstraint({ name: 'isPersonName', async: false })
export class IsPersonNameConstraint implements ValidatorConstraintInterface {
  validate(name: unknown, _args: ValidationArguments): boolean {
    if (name === undefined || name === null || name === '') return true; // other validators handle empties
    return isValidPersonName(name);
  }

  defaultMessage(): string {
    return "Please enter a valid name. Letters of any language, numbers, spaces and . , ' - ( ) are allowed.";
  }
}

export function IsPersonName(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsPersonNameConstraint,
    });
  };
}
