import { getDb } from '@bella/db';
import { evidence } from '@bella/db';
import { eq } from 'drizzle-orm';
import { UploadForm } from '@/components/upload/upload-form';
import { ShieldAlertIcon } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Upload Evidence - Bella Insurance',
  description: 'Upload evidence for your insurance claim',
};

interface UploadPageProps {
  params: Promise<{ token: string }>;
}

export default async function UploadPage({ params }: UploadPageProps) {
  const { token } = await params;

  let record = null;
  try {
    const db = getDb();
    record = await db.query.evidence.findFirst({
      where: eq(evidence.uploadToken, token),
    });
  } catch {
    record = null;
  }

  const isValid = record && record.status === 'pending';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-2xl font-bold">
            B
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Bella Insurance</h1>
          {isValid ? (
            <p className="text-muted-foreground">
              Please upload your evidence for your claim
            </p>
          ) : (
            <p className="text-muted-foreground">Evidence Upload</p>
          )}
        </div>

        {isValid ? (
          <UploadForm token={token} description={record?.description} />
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-xl border bg-white p-8 text-center shadow-sm dark:bg-slate-900">
            <ShieldAlertIcon className="size-12 text-destructive/70" />
            <h2 className="font-display text-lg font-semibold">Invalid Upload Link</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              This upload link is invalid, has already been used, or has expired.
              Please contact your insurance agent for a new link.
            </p>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} Bella Insurance. All rights reserved.
        </p>
      </div>
    </div>
  );
}
