import { UserRole } from '../../common/enums/user-role.enum';

export const sampleUsers = [
  {
    name: 'John Admin',
    email: 'admin@examflex.com',
    phoneNumber: '+1234567890',
    role: UserRole.ADMIN,
    isActive: true,
  },
  {
    name: 'Jane User',
    email: 'jane.user@example.com',
    phoneNumber: '+1234567891',
    role: UserRole.USER,
    isActive: true,
  },
  {
    name: 'Bob Student',
    email: 'bob.student@example.com',
    phoneNumber: '+1234567892',
    role: UserRole.USER,
    isActive: true,
  },
  {
    name: 'Alice Manager',
    email: 'alice.manager@examflex.com',
    phoneNumber: '+1234567893',
    role: UserRole.ADMIN,
    isActive: true,
  },
  {
    name: 'Charlie Test',
    email: 'charlie.test@example.com',
    phoneNumber: '+1234567894',
    role: UserRole.USER,
    isActive: false,
  },
];
