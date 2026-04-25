import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import {
  callSessions,
  customers,
  claims,
  transcripts,
  type CallSession,
  type Customer,
  type Claim,
  type Transcript,
} from '@bella/db';
import { eq, asc } from 'drizzle-orm';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatDuration, formatPhone } from '@/lib/format';
import { TranscriptViewer } from '@/components/calls/transcript-viewer';

const statusColors: Record<string, string> = {
  active:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  completed:
    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const statusLabels: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  failed: 'Failed',
};

interface CallData {
  session: CallSession;
  customer: Customer | null;
  claim: Claim | null;
  transcriptEntries: Transcript[];
}

async function getCallData(id: string): Promise<CallData | null> {
  try {
    const db = getDb();

    const [session] = await db
      .select()
      .from(callSessions)
      .where(eq(callSessions.id, id))
      .limit(1);

    if (!session) return null;

    let customer: Customer | null = null;
    if (session.customerId) {
      const [row] = await db
        .select()
        .from(customers)
        .where(eq(customers.id, session.customerId))
        .limit(1);
      customer = row ?? null;
    }

    let claim: Claim | null = null;
    if (session.claimId) {
      const [row] = await db
        .select()
        .from(claims)
        .where(eq(claims.id, session.claimId))
        .limit(1);
      claim = row ?? null;
    }

    const transcriptEntries = await db
      .select()
      .from(transcripts)
      .where(eq(transcripts.sessionId, id))
      .orderBy(asc(transcripts.createdAt));

    return { session, customer, claim, transcriptEntries };
  } catch {
    return null;
  }
}

const claimStatusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  gathering_info:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  ready_for_review:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  submitted:
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  under_review:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  approved:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  denied: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  closed: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

const claimStatusLabels: Record<string, string> = {
  draft: 'Draft',
  gathering_info: 'Gathering Info',
  ready_for_review: 'Ready for Review',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  denied: 'Denied',
  closed: 'Closed',
};

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getCallData(id);

  if (!data) {
    notFound();
  }

  const { session, customer, claim, transcriptEntries } = data;

  return (
    <div className="space-y-6">
      <Link
        href="/calls"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to Calls
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {formatPhone(session.callerPhone)}
          </h1>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[session.status] ?? ''}`}
          >
            {statusLabels[session.status] ?? session.status}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
          <span>Started: {formatDate(session.startedAt)}</span>
          <span>
            Duration: {formatDuration(session.startedAt, session.endedAt)}
          </span>
          {customer && (
            <span>
              Customer:{' '}
              <Link
                href={`/customers/${customer.id}`}
                className="text-primary hover:underline"
              >
                {customer.firstName} {customer.lastName}
              </Link>
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: transcript */}
        <div className="space-y-6 lg:col-span-2">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">
                {session.summary || (
                  <span className="italic text-muted-foreground">
                    No summary available yet.
                  </span>
                )}
              </p>
            </CardContent>
          </Card>

          {/* Transcript */}
          <Card>
            <CardHeader>
              <CardTitle>
                Transcript ({transcriptEntries.length} messages)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TranscriptViewer entries={transcriptEntries} />
            </CardContent>
          </Card>
        </div>

        {/* Right column: metadata */}
        <div className="space-y-6">
          {/* Call Info */}
          <Card>
            <CardHeader>
              <CardTitle>Call Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Session ID</span>
                <span className="font-mono text-xs">
                  {session.id.slice(0, 8)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Twilio SID</span>
                <span className="font-mono text-xs truncate max-w-[140px]">
                  {session.twilioCallSid}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone</span>
                <span>{formatPhone(session.callerPhone)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="capitalize">{session.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Started</span>
                <span>{formatDate(session.startedAt)}</span>
              </div>
              {session.endedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ended</span>
                  <span>{formatDate(session.endedAt)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Linked Claim */}
          {claim && (
            <Card>
              <CardHeader>
                <CardTitle>Linked Claim</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <Link
                    href={`/claims/${claim.id}`}
                    className="font-mono text-primary hover:underline"
                  >
                    {claim.id.slice(0, 8)}
                  </Link>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${claimStatusColors[claim.status] ?? ''}`}
                  >
                    {claimStatusLabels[claim.status] ?? claim.status}
                  </span>
                </div>
                <p className="text-muted-foreground">
                  Type:{' '}
                  <span className="capitalize text-foreground">
                    {claim.type}
                  </span>
                </p>
                {claim.description && (
                  <p className="text-muted-foreground line-clamp-3">
                    {claim.description}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Customer Card */}
          {customer && (
            <Card>
              <CardHeader>
                <CardTitle>Customer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <Link
                    href={`/customers/${customer.id}`}
                    className="text-primary hover:underline"
                  >
                    {customer.firstName} {customer.lastName}
                  </Link>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone</span>
                  <span>{formatPhone(customer.phone)}</span>
                </div>
                {customer.email && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span className="truncate max-w-[160px]">
                      {customer.email}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
