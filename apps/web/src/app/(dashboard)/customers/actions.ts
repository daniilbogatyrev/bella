'use server';

import { getDb } from '@bella/db';
import { customers, policies } from '@bella/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PolicyType = 'auto' | 'health' | 'liability' | 'home' | 'life' | 'travel';

const POLICY_DEFAULTS: Record<PolicyType, { planName: string; premium: string; coveredItems: string; notCoveredItems: string }> = {
  auto: {
    planName: 'Auto Insurance',
    premium: '150.00',
    coveredItems: 'Collision damage, liability, medical payments, uninsured motorist, roadside assistance, rental car reimbursement',
    notCoveredItems: 'Wear & tear, mechanical breakdown, personal belongings in car, commercial use',
  },
  health: {
    planName: 'Health Insurance',
    premium: '350.00',
    coveredItems: 'Hospitalization, surgery, prescription drugs, preventive care, mental health services, emergency room visits',
    notCoveredItems: 'Cosmetic procedures, experimental treatments, dental (separate plan), vision (separate plan)',
  },
  home: {
    planName: 'Home Insurance',
    premium: '125.00',
    coveredItems: 'Dwelling structure, personal property, liability, additional living expenses, fire/theft/vandalism',
    notCoveredItems: 'Flood damage, earthquake, normal wear, pest damage, home business equipment',
  },
  life: {
    planName: 'Life Insurance',
    premium: '75.00',
    coveredItems: 'Death benefit, terminal illness advance, accidental death (2x benefit), dependent coverage',
    notCoveredItems: 'Suicide within first 2 years, death during illegal activity, war/terrorism',
  },
  travel: {
    planName: 'Travel Insurance',
    premium: '45.00',
    coveredItems: 'Trip cancellation, medical emergencies abroad, lost baggage, flight delays, emergency evacuation',
    notCoveredItems: 'Pre-existing conditions, extreme sports, travel to sanctioned countries',
  },
  liability: {
    planName: 'Liability Insurance',
    premium: '100.00',
    coveredItems: 'Bodily injury to others, property damage to others, legal defense costs, personal liability',
    notCoveredItems: 'Intentional acts, professional errors (need E&O), auto liability (separate policy)',
  },
};

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not authenticated');
  return session;
}

export async function createCustomer(data: {
  firstName: string;
  lastName: string;
  phone: string;
  dob?: string;
  email?: string;
  address?: string;
  policyTypes?: PolicyType[];
}): Promise<{ success: boolean; error?: string; id?: string }> {
  await requireAuth();

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

    const customerId = rows[0]?.id;
    if (customerId && data.policyTypes && data.policyTypes.length > 0) {
      const today = new Date().toISOString().split('T')[0]!;
      const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;

      await db.insert(policies).values(
        data.policyTypes.map((type) => {
          const defaults = POLICY_DEFAULTS[type];
          return {
            customerId,
            type,
            planName: defaults.planName,
            status: 'active' as const,
            premium: defaults.premium,
            startDate: today,
            endDate: nextYear,
            coveredItems: defaults.coveredItems,
            notCoveredItems: defaults.notCoveredItems,
          };
        }),
      );
    }

    revalidatePath('/customers');
    return { success: true, id: customerId };
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
  await requireAuth();

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
  await requireAuth();

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
