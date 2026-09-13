import bcrypt from 'bcrypt';
import { z } from 'zod';
import { User, publicUser } from '../users/user.model.js';

export class ProvisioningError extends Error {}

const credentialsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().max(254).email(),
    password: z
      .string()
      .min(12)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
  })
  .strict();

export function validateAdminCredentials(input) {
  const result = credentialsSchema.safeParse(input);
  if (!result.success) {
    throw new ProvisioningError(
      'Provide only name, valid email, and a password of at least 12 characters and at most 72 UTF-8 bytes.',
    );
  }
  return result.data;
}

export async function provisionInitialAdmin(input) {
  const { name, email, password } = validateAdminCredentials(input);
  // The sparse unique key makes concurrent bootstrap inserts mutually exclusive.
  await User.init();
  if (await User.exists({ role: 'admin' })) {
    throw new ProvisioningError(
      'An admin already exists. Initial provisioning is disabled.',
    );
  }
  if (await User.exists({ email })) {
    throw new ProvisioningError(
      'Email already belongs to an account. No account was changed.',
    );
  }
  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await User.create({
      name,
      email,
      passwordHash,
      role: 'admin',
      bootstrapKey: 'initial-admin',
    });
    return publicUser(user);
  } catch (error) {
    if (error.code === 11000) {
      throw new ProvisioningError(
        'Initial provisioning was already used or the email is occupied. No account was changed.',
      );
    }
    throw error;
  }
}
