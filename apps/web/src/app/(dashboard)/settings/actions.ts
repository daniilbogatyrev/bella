'use server';

import { getDb } from '@/lib/db';
import { adminUsers } from '@bella/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not authenticated');
  if (session.user.role !== 'admin') throw new Error('Not authorized');
  return session;
}

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not authenticated');
  return session;
}

export async function getAdminUsers() {
  await requireAdmin();
  const db = getDb();
  return db.query.adminUsers.findMany({
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  });
}

export async function addAdmin(
  email: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin();
  if (!session) return { success: false, error: 'Not authorized' };

  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_REGEX.test(trimmed)) {
    return { success: false, error: 'Invalid email address' };
  }

  try {
    const db = getDb();
    const existing = await db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, trimmed),
    });
    if (existing) {
      return { success: false, error: 'This email is already an admin' };
    }

    await db.insert(adminUsers).values({
      email: trimmed,
      role: 'admin',
    });

    revalidatePath('/settings');
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to add admin' };
  }
}

export async function removeAdmin(
  adminId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAdmin();

  try {
    const db = getDb();
    const target = await db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, adminId),
    });

    if (!target) {
      return { success: false, error: 'Admin not found' };
    }

    if (target.email === session.user.email) {
      return { success: false, error: "You can't remove yourself" };
    }

    await db.delete(adminUsers).where(eq(adminUsers.id, adminId));
    revalidatePath('/settings');
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to remove admin' };
  }
}

export async function getPasswordStatus(): Promise<{ hasPassword: boolean }> {
  const session = await requireAuth();
  const db = getDb();
  const admin = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.email, session.user.email!),
  });
  return { hasPassword: !!admin?.passwordHash };
}

export async function setPassword(
  currentPassword: string | null,
  newPassword: string,
  confirmPassword: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireAuth();

  if (newPassword !== confirmPassword) {
    return { success: false, error: 'Passwords do not match' };
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }

  try {
    const db = getDb();
    const admin = await db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, session.user.email!),
    });

    if (!admin) {
      return { success: false, error: 'User not found' };
    }

    if (admin.passwordHash && currentPassword) {
      const valid = await Bun.password.verify(currentPassword, admin.passwordHash);
      if (!valid) {
        return { success: false, error: 'Current password is incorrect' };
      }
    } else if (admin.passwordHash && !currentPassword) {
      return { success: false, error: 'Current password is required' };
    }

    const hash = await Bun.password.hash(newPassword);

    await db
      .update(adminUsers)
      .set({ passwordHash: hash })
      .where(eq(adminUsers.id, admin.id));

    revalidatePath('/settings');
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to update password' };
  }
}
