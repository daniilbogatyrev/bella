'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { PlusIcon } from 'lucide-react';
import { createClaim, getCustomers, getCustomerPolicies } from '@/app/(dashboard)/claims/actions';

const CLAIM_TYPES = ['auto', 'health', 'home', 'life', 'travel', 'liability'] as const;

type Customer = { id: string; firstName: string; lastName: string; phone: string };
type Policy = { id: string; type: string; planName: string; status: string };

export function NewClaimDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [customerList, setCustomerList] = useState<Customer[]>([]);
  const [policyList, setPolicyList] = useState<Policy[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingPolicies, setLoadingPolicies] = useState(false);

  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedPolicyId, setSelectedPolicyId] = useState('');
  const [claimType, setClaimType] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoadingCustomers(true);
    getCustomers()
      .then(setCustomerList)
      .finally(() => setLoadingCustomers(false));
  }, [open]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setPolicyList([]);
      setSelectedPolicyId('');
      return;
    }
    setLoadingPolicies(true);
    setSelectedPolicyId('');
    getCustomerPolicies(selectedCustomerId)
      .then(setPolicyList)
      .finally(() => setLoadingPolicies(false));
  }, [selectedCustomerId]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const errs: Record<string, string> = {};

    if (!selectedCustomerId) errs.customer = 'Customer is required';
    if (!selectedPolicyId) errs.policy = 'Policy is required';
    if (!claimType) errs.type = 'Claim type is required';
    if (!form.get('description')?.toString().trim()) errs.description = 'Description is required';
    if (!form.get('incidentDate')?.toString()) errs.incidentDate = 'Incident date is required';

    setErrors(errs);
    setServerError('');
    if (Object.keys(errs).length > 0) return;

    startTransition(async () => {
      const result = await createClaim({
        customerId: selectedCustomerId,
        policyId: selectedPolicyId,
        type: claimType,
        description: form.get('description') as string,
        incidentDate: form.get('incidentDate') as string,
        incidentLocation: (form.get('incidentLocation') as string) || undefined,
      });
      if (result.success && result.id) {
        setOpen(false);
        router.push(`/claims/${result.id}`);
      } else {
        setServerError(result.error ?? 'Failed to create claim');
      }
    });
  }

  function resetForm() {
    setSelectedCustomerId('');
    setSelectedPolicyId('');
    setClaimType('');
    setPolicyList([]);
    setErrors({});
    setServerError('');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogTrigger
        render={
          <Button>
            <PlusIcon data-icon="inline-start" />
            New Claim
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Claim</DialogTitle>
          <DialogDescription>Create a new insurance claim.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-3">
          {serverError && (
            <p className="text-sm text-destructive">{serverError}</p>
          )}

          {/* Customer */}
          <div className="grid gap-1.5">
            <Label>Customer *</Label>
            <Select
              value={selectedCustomerId}
              onValueChange={(v) => setSelectedCustomerId(v ?? '')}
              disabled={loadingCustomers}
            >
              <SelectTrigger className="w-full" aria-invalid={!!errors.customer}>
                <SelectValue placeholder={loadingCustomers ? 'Loading…' : 'Select customer'} />
              </SelectTrigger>
              <SelectContent>
                {customerList.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.firstName} {c.lastName} ({c.phone})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.customer && <p className="text-xs text-destructive">{errors.customer}</p>}
          </div>

          {/* Policy */}
          <div className="grid gap-1.5">
            <Label>Policy *</Label>
            <Select
              value={selectedPolicyId}
              onValueChange={(v) => setSelectedPolicyId(v ?? '')}
              disabled={!selectedCustomerId || loadingPolicies}
            >
              <SelectTrigger className="w-full" aria-invalid={!!errors.policy}>
                <SelectValue
                  placeholder={
                    !selectedCustomerId
                      ? 'Select a customer first'
                      : loadingPolicies
                        ? 'Loading…'
                        : policyList.length === 0
                          ? 'No policies found'
                          : 'Select policy'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {policyList.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.planName} ({p.type}) — {p.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.policy && <p className="text-xs text-destructive">{errors.policy}</p>}
          </div>

          {/* Type */}
          <div className="grid gap-1.5">
            <Label>Claim Type *</Label>
            <Select value={claimType} onValueChange={(v) => setClaimType(v ?? '')}>
              <SelectTrigger className="w-full" aria-invalid={!!errors.type}>
                <SelectValue placeholder="Select claim type" />
              </SelectTrigger>
              <SelectContent>
                {CLAIM_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.type && <p className="text-xs text-destructive">{errors.type}</p>}
          </div>

          {/* Description */}
          <div className="grid gap-1.5">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="Describe the incident..."
              rows={3}
              aria-invalid={!!errors.description}
            />
            {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
          </div>

          {/* Incident date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="incidentDate">Incident Date *</Label>
              <Input
                id="incidentDate"
                name="incidentDate"
                type="date"
                aria-invalid={!!errors.incidentDate}
              />
              {errors.incidentDate && <p className="text-xs text-destructive">{errors.incidentDate}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="incidentLocation">Location</Label>
              <Input
                id="incidentLocation"
                name="incidentLocation"
                placeholder="e.g. 123 Main St"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create Claim'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
