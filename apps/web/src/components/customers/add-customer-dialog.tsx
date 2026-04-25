'use client';

import { useState, useTransition } from 'react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PlusIcon } from 'lucide-react';
import { createCustomer } from '@/app/(dashboard)/customers/actions';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddCustomerDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');

  function validate(form: FormData): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!form.get('firstName')?.toString().trim()) errs.firstName = 'First name is required';
    if (!form.get('lastName')?.toString().trim()) errs.lastName = 'Last name is required';
    const phone = form.get('phone')?.toString().trim() ?? '';
    if (!phone) {
      errs.phone = 'Phone is required';
    } else if (!E164_REGEX.test(phone)) {
      errs.phone = 'Must be E.164 format (e.g. +15551234567)';
    }
    const email = form.get('email')?.toString().trim() ?? '';
    if (email && !EMAIL_REGEX.test(email)) {
      errs.email = 'Invalid email address';
    }
    return errs;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const fieldErrors = validate(form);
    setErrors(fieldErrors);
    setServerError('');
    if (Object.keys(fieldErrors).length > 0) return;

    startTransition(async () => {
      const result = await createCustomer({
        firstName: form.get('firstName') as string,
        lastName: form.get('lastName') as string,
        phone: form.get('phone') as string,
        dob: (form.get('dob') as string) || undefined,
        email: (form.get('email') as string) || undefined,
        address: (form.get('address') as string) || undefined,
      });
      if (result.success) {
        setOpen(false);
        setErrors({});
      } else {
        setServerError(result.error ?? 'Failed to create customer');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <PlusIcon data-icon="inline-start" />
            Add Customer
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Customer</DialogTitle>
          <DialogDescription>Enter the customer&apos;s information below.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          {serverError && (
            <p className="text-sm text-destructive">{serverError}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="firstName">First Name *</Label>
              <Input id="firstName" name="firstName" placeholder="John" aria-invalid={!!errors.firstName} />
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lastName">Last Name *</Label>
              <Input id="lastName" name="lastName" placeholder="Doe" aria-invalid={!!errors.lastName} />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="phone">Phone *</Label>
            <Input id="phone" name="phone" placeholder="+15551234567" aria-invalid={!!errors.phone} />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" placeholder="john@example.com" aria-invalid={!!errors.email} />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dob">Date of Birth</Label>
            <Input id="dob" name="dob" type="date" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="address">Address</Label>
            <Textarea id="address" name="address" placeholder="123 Main St, City, State" rows={2} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating...' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
