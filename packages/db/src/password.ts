import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith('$argon2')) {
    // Legacy argon2 hash from Bun.password.hash — re-seed the DB to migrate to bcrypt
    return false;
  }
  return bcrypt.compare(password, hash);
}
