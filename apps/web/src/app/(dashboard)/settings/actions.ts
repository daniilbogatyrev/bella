'use server';

import { getDb } from '@/lib/db';
import { adminUsers } from '@bella/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not authenticated');
  if (session.user.role !== 'admin') throw new Error('Not authorized');
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
