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
import { PlusIcon, CheckIcon } from 'lucide-react';
import { createCustomer } from '@/app/(dashboard)/customers/actions';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const POLICY_TYPES = [
  { value: 'auto', label: 'Auto' },
  { value: 'health', label: 'Health' },
  { value: 'home', label: 'Home' },
  { value: 'life', label: 'Life' },
  { value: 'travel', label: 'Travel' },
  { value: 'liability', label: 'Liability' },
] as const;

type PolicyType = (typeof POLICY_TYPES)[number]['value'];

export function AddCustomerDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [selectedPolicies, setSelectedPolicies] = useState<PolicyType[]>([]);

  function togglePolicy(type: PolicyType) {
    setSelectedPolicies((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

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
        policyTypes: selectedPolicies.length > 0 ? selectedPolicies : undefined,
      });
      if (result.success) {
        setOpen(false);
        setErrors({});
        setSelectedPolicies([]);
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
          <div className="grid gap-1.5">
            <Label>Policies</Label>
            <div className="flex flex-wrap gap-2">
              {POLICY_TYPES.map((pt) => {
                const isSelected = selectedPolicies.includes(pt.value);
                return (
                  <button
                    key={pt.value}
                    type="button"
                    onClick={() => togglePolicy(pt.value)}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    {isSelected && <CheckIcon className="size-3" />}
                    {pt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Select policies to create for this customer. Each will start today with a 1-year term.
            </p>
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
