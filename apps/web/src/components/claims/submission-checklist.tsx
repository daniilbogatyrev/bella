'use client';

import { Button } from '@/components/ui/button';

export interface ChecklistItem {
  label: string;
  passed: boolean;
}

export function SubmissionChecklist({
  items,
  canSubmit,
  onSubmit,
}: {
  items: ChecklistItem[];
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className={item.passed ? 'text-green-500' : 'text-red-500'}>
            {item.passed ? '✅' : '❌'}
          </span>
          <span
            className={
              item.passed ? 'text-foreground' : 'text-muted-foreground'
            }
          >
            {item.label}
          </span>
        </div>
      ))}
      <Button onClick={onSubmit} disabled={!canSubmit} className="mt-4">
        Submit Claim for Review
      </Button>
    </div>
  );
}
