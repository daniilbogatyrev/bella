'use server';

import { getDb } from '@bella/db';
import { customers, policies } from '@bella/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createCustomer(data: {
  firstName: string;
  lastName: string;
  phone: string;
  dob?: string;
  email?: string;
  address?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  if (!data.firstName.trim() || !data.lastName.trim()) {
    return { success: false, error: 'First name and last name are required' };
  }
  if (!E164_REGEX.test(data.phone)) {
    return { success: false, error: 'Phone must be in E.164 format (e.g. +15551234567)' };
  }
  if (data.email && !EMAIL_REGEX.test(data.email)) {
    return { success: false, error: 'Invalid email address' };
  }

  try {
    const db = getDb();
    const rows = await db.insert(customers).values({
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      phone: data.phone.trim(),
      dob: data.dob || null,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
    }).returning({ id: customers.id });
    revalidatePath('/customers');
    return { success: true, id: rows[0]?.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('unique') || message.includes('duplicate')) {
      return { success: false, error: 'A customer with this phone number already exists' };
    }
    return { success: false, error: 'Failed to create customer' };
  }
}

export async function updateCustomer(
  id: string,
  data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    dob?: string | null;
    email?: string | null;
    address?: string | null;
  },
): Promise<{ success: boolean; error?: string }> {
  if (data.phone && !E164_REGEX.test(data.phone)) {
    return { success: false, error: 'Phone must be in E.164 format (e.g. +15551234567)' };
  }
  if (data.email && !EMAIL_REGEX.test(data.email)) {
    return { success: false, error: 'Invalid email address' };
  }

  try {
    const db = getDb();
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (data.firstName !== undefined) updates.firstName = data.firstName.trim();
    if (data.lastName !== undefined) updates.lastName = data.lastName.trim();
    if (data.phone !== undefined) updates.phone = data.phone.trim();
    if (data.dob !== undefined) updates.dob = data.dob;
    if (data.email !== undefined) updates.email = data.email?.trim() || null;
    if (data.address !== undefined) updates.address = data.address?.trim() || null;

    await db.update(customers).set(updates).where(eq(customers.id, id));
    revalidatePath('/customers');
    revalidatePath(`/customers/${id}`);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('unique') || message.includes('duplicate')) {
      return { success: false, error: 'A customer with this phone number already exists' };
    }
    return { success: false, error: 'Failed to update customer' };
  }
}

export async function createPolicy(data: {
  customerId: string;
  type: string;
  planName: string;
  premium?: string;
  startDate: string;
  endDate?: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  if (!data.planName.trim()) {
    return { success: false, error: 'Plan name is required' };
  }
  if (!data.startDate) {
    return { success: false, error: 'Start date is required' };
  }

  try {
    const db = getDb();
    const rows = await db.insert(policies).values({
      customerId: data.customerId,
      type: data.type as 'auto' | 'health' | 'liability' | 'home' | 'life' | 'travel',
      planName: data.planName.trim(),
      premium: data.premium || null,
      startDate: data.startDate,
      endDate: data.endDate || null,
    }).returning({ id: policies.id });
    revalidatePath(`/customers/${data.customerId}`);
    return { success: true, id: rows[0]?.id };
  } catch {
    return { success: false, error: 'Failed to create policy' };
  }
}
