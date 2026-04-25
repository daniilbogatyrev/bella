'use client';

import { useState } from 'react';
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
import { Phone } from 'lucide-react';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export function TestCallDialog() {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [result, setResult] = useState<{
    callSid?: string;
    status?: string;
  } | null>(null);

  function reset() {
    setPhone('');
    setError('');
    setStatus('idle');
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setResult(null);

    const trimmed = phone.trim();
    if (!trimmed) {
      setError('Phone number is required');
      return;
    }
    if (!E164_REGEX.test(trimmed)) {
      setError('Must be E.164 format (e.g. +15551234567)');
      return;
    }

    setStatus('loading');

    try {
      const res = await fetch('/api/calls/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus('error');
        setError(data.error || 'Failed to initiate call');
        return;
      }

      setStatus('success');
      setResult(data);
    } catch {
      setStatus('error');
      setError('Network error — could not reach the server');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button variant="outline">
            <Phone data-icon="inline-start" />
            Test Call
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Initiate Test Call</DialogTitle>
          <DialogDescription>
            Place an outbound call via Twilio that connects to the WebSocket
            server. The called party will hear the AI agent.
          </DialogDescription>
        </DialogHeader>

        {status === 'success' && result ? (
          <div className="grid gap-2">
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950/30">
              <p className="font-medium text-green-700 dark:text-green-400">
                Call initiated successfully
              </p>
              <p className="mt-1 text-green-600 dark:text-green-500">
                SID: <span className="font-mono">{result.callSid}</span>
              </p>
              <p className="text-green-600 dark:text-green-500">
                Status: {result.status}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button onClick={reset}>Call Another</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="grid gap-3">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="grid gap-1.5">
              <Label htmlFor="test-call-phone">Phone Number</Label>
              <Input
                id="test-call-phone"
                placeholder="+15551234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-invalid={!!error}
              />
              <p className="text-xs text-muted-foreground">
                E.164 format — include country code (e.g. +1 for US)
              </p>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={status === 'loading'}>
                {status === 'loading' ? 'Calling…' : 'Place Call'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
