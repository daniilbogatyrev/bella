import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import {
  claims,
  customers,
  claimEvents,
  evidence,
  callSessions,
  type Claim,
  type Customer,
  type ClaimEvent,
  type Evidence,
  type CallSession,
} from '@bella/db';
import { eq, asc, desc } from 'drizzle-orm';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EvidenceGallery } from '@/components/claims/evidence-gallery';
import { ClaimEventsTimeline } from '@/components/claims/claim-events-timeline';
import { ClaimActions } from './claim-actions';

const statusColors: Record<string, string> = {
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

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  gathering_info: 'Gathering Info',
  ready_for_review: 'Ready for Review',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  denied: 'Denied',
  closed: 'Closed',
};

interface ClaimData {
  claim: Claim;
  customer: Customer;
  events: ClaimEvent[];
  evidenceItems: Evidence[];
  sessions: CallSession[];
}

async function getClaimData(
  id: string
): Promise<ClaimData | null> {
  try {
    const db = getDb();

    const [claimRow] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, id))
      .limit(1);

    if (!claimRow) return null;

    const [customer] = await db
      .select()
      .from(customers)
      .where(eq(customers.id, claimRow.customerId))
      .limit(1);

    if (!customer) return null;

    const events = await db
      .select()
      .from(claimEvents)
      .where(eq(claimEvents.claimId, id))
      .orderBy(asc(claimEvents.createdAt));

    const evidenceItems = await db
      .select()
      .from(evidence)
      .where(eq(evidence.claimId, id))
      .orderBy(desc(evidence.createdAt));

    const sessions = await db
      .select()
      .from(callSessions)
      .where(eq(callSessions.claimId, id))
      .orderBy(desc(callSessions.startedAt));

    return { claim: claimRow, customer, events, evidenceItems, sessions };
  } catch {
    return null;
  }
}

function buildChecklist(data: ClaimData) {
  const { claim, evidenceItems, events } = data;

  const hasDescription = !!claim.description?.trim();
  const hasIncidentDate = claim.incidentDate !== null;
  const hasIncidentLocation = !!claim.incidentLocation?.trim();
  const hasUploadedEvidence = evidenceItems.some(
    (e) => e.status === 'uploaded' || e.status === 'verified'
  );
  const hasIdentityConfirmed = events.some(
    (e) =>
      e.type === 'fact' &&
      e.content.toLowerCase().includes('identity confirmed')
  );

  const items = [
    { label: 'Description filled', passed: hasDescription },
    { label: 'Incident date set', passed: hasIncidentDate },
    { label: 'Incident location set', passed: hasIncidentLocation },
    { label: 'At least 1 evidence item uploaded', passed: hasUploadedEvidence },
    { label: 'Customer identity confirmed', passed: hasIdentityConfirmed },
  ];

  const allPassed = items.every((i) => i.passed);

  return { items, allPassed };
}

function formatDuration(start: Date, end: Date | null): string {
  if (!end) return 'Ongoing';
  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export default async function ClaimDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getClaimData(id);

  if (!data) {
    notFound();
  }

  const { claim, customer, events, evidenceItems, sessions } = data;
  const { items: checklistItems, allPassed } = buildChecklist(data);

  const canSubmit =
    allPassed &&
    ['draft', 'gathering_info', 'ready_for_review'].includes(claim.status);
  const canApprove = claim.status === 'under_review';
  const canDeny = claim.status === 'under_review';
  const canClose =
    claim.status === 'approved' || claim.status === 'denied';

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/claims"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to Claims
      </Link>

      {/* Header Section */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">
              Claim {claim.id.slice(0, 8)}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusColors[claim.status] ?? ''}`}
            >
              {statusLabels[claim.status] ?? claim.status}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span>Type: <span className="capitalize text-foreground">{claim.type}</span></span>
            <span>
              Customer:{' '}
              <Link href={`/customers/${customer.id}`} className="text-primary hover:underline">
                {customer.firstName} {customer.lastName}
              </Link>
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Created: {claim.createdAt.toLocaleDateString()}</span>
            <span>Updated: {claim.updatedAt.toLocaleDateString()}</span>
            {claim.submittedAt && (
              <span>Submitted: {claim.submittedAt.toLocaleDateString()}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Description */}
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                {claim.description || (
                  <span className="italic text-muted-foreground">
                    No description provided
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Incident Date:</span>{' '}
                  {claim.incidentDate ?? (
                    <span className="italic text-muted-foreground">Not set</span>
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Location:</span>{' '}
                  {claim.incidentLocation || (
                    <span className="italic text-muted-foreground">Not set</span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Events Timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Events Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ClaimEventsTimeline events={events} />
            </CardContent>
          </Card>

          {/* Evidence Gallery */}
          <Card>
            <CardHeader>
              <CardTitle>Evidence</CardTitle>
            </CardHeader>
            <CardContent>
              <EvidenceGallery items={evidenceItems} />
            </CardContent>
          </Card>

          {/* Linked Calls */}
          <Card>
            <CardHeader>
              <CardTitle>Linked Calls</CardTitle>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No calls linked to this claim.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Summary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((session) => (
                      <TableRow key={session.id}>
                        <TableCell>
                          <Link
                            href={`/calls/${session.id}`}
                            className="text-primary hover:underline"
                          >
                            {session.startedAt.toLocaleString()}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {formatDuration(session.startedAt, session.endedAt)}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {session.summary || (
                            <span className="italic text-muted-foreground">
                              No summary
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: checklist + actions */}
        <div className="space-y-6">
          {/* Submission Checklist */}
          <Card>
            <CardHeader>
              <CardTitle>Submission Checklist</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {checklistItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span
                      className={
                        item.passed ? 'text-green-500' : 'text-red-500'
                      }
                    >
                      {item.passed ? '✅' : '❌'}
                    </span>
                    <span
                      className={
                        item.passed
                          ? 'text-foreground text-sm'
                          : 'text-muted-foreground text-sm'
                      }
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <ClaimActions
                claimId={claim.id}
                canSubmit={canSubmit}
                canApprove={canApprove}
                canDeny={canDeny}
                canClose={canClose}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
