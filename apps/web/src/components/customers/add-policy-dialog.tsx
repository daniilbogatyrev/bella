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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { PlusIcon } from 'lucide-react';
import { createPolicy } from '@/app/(dashboard)/customers/actions';

const POLICY_TYPES = ['auto', 'health', 'liability', 'home', 'life', 'travel'] as const;

interface AddPolicyDialogProps {
  customerId: string;
}

export function AddPolicyDialog({ customerId }: AddPolicyDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [policyType, setPolicyType] = useState<string>('auto');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const errs: Record<string, string> = {};
    if (!form.get('planName')?.toString().trim()) errs.planName = 'Plan name is required';
    if (!form.get('startDate')?.toString()) errs.startDate = 'Start date is required';
    setErrors(errs);
    setServerError('');
    if (Object.keys(errs).length > 0) return;

    startTransition(async () => {
      const result = await createPolicy({
        customerId,
        type: policyType,
        planName: form.get('planName') as string,
        premium: (form.get('premium') as string) || undefined,
        startDate: form.get('startDate') as string,
        endDate: (form.get('endDate') as string) || undefined,
      });
      if (result.success) {
        setOpen(false);
        setErrors({});
        setPolicyType('auto');
      } else {
        setServerError(result.error ?? 'Failed to create policy');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <PlusIcon data-icon="inline-start" />
            Add Policy
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Policy</DialogTitle>
          <DialogDescription>Create a new policy for this customer.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          {serverError && (
            <p className="text-sm text-destructive">{serverError}</p>
          )}
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={policyType} onValueChange={(v) => setPolicyType(v ?? 'auto')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {POLICY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="planName">Plan Name *</Label>
            <Input id="planName" name="planName" placeholder="e.g. Gold Plan" aria-invalid={!!errors.planName} />
            {errors.planName && <p className="text-xs text-destructive">{errors.planName}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="premium">Monthly Premium ($)</Label>
            <Input id="premium" name="premium" type="number" step="0.01" min="0" placeholder="0.00" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="startDate">Start Date *</Label>
              <Input id="startDate" name="startDate" type="date" aria-invalid={!!errors.startDate} />
              {errors.startDate && <p className="text-xs text-destructive">{errors.startDate}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="endDate">End Date</Label>
              <Input id="endDate" name="endDate" type="date" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating...' : 'Create Policy'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
