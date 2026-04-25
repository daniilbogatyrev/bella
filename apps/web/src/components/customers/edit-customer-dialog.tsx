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
import { PencilIcon } from 'lucide-react';
import { updateCustomer } from '@/app/(dashboard)/customers/actions';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EditCustomerDialogProps {
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    dob: string | null;
    email: string | null;
    address: string | null;
  };
}

export function EditCustomerDialog({ customer }: EditCustomerDialogProps) {
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
      const result = await updateCustomer(customer.id, {
        firstName: form.get('firstName') as string,
        lastName: form.get('lastName') as string,
        phone: form.get('phone') as string,
        dob: (form.get('dob') as string) || null,
        email: (form.get('email') as string) || null,
        address: (form.get('address') as string) || null,
      });
      if (result.success) {
        setOpen(false);
        setErrors({});
      } else {
        setServerError(result.error ?? 'Failed to update customer');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Customer</DialogTitle>
          <DialogDescription>Update the customer&apos;s information.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          {serverError && (
            <p className="text-sm text-destructive">{serverError}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-firstName">First Name *</Label>
              <Input
                id="edit-firstName"
                name="firstName"
                defaultValue={customer.firstName}
                aria-invalid={!!errors.firstName}
              />
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-lastName">Last Name *</Label>
              <Input
                id="edit-lastName"
                name="lastName"
                defaultValue={customer.lastName}
                aria-invalid={!!errors.lastName}
              />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-phone">Phone *</Label>
            <Input
              id="edit-phone"
              name="phone"
              defaultValue={customer.phone}
              aria-invalid={!!errors.phone}
            />
            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              name="email"
              type="email"
              defaultValue={customer.email ?? ''}
              aria-invalid={!!errors.email}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-dob">Date of Birth</Label>
            <Input id="edit-dob" name="dob" type="date" defaultValue={customer.dob ?? ''} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-address">Address</Label>
            <Textarea
              id="edit-address"
              name="address"
              defaultValue={customer.address ?? ''}
              rows={2}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
