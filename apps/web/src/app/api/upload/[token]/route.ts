import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@bella/db';
import { evidence } from '@bella/db';
import { eq } from 'drizzle-orm';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'video/mp4',
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503 },
    );
  }

  let record;
  try {
    record = await db.query.evidence.findFirst({
      where: eq(evidence.uploadToken, token),
    });
  } catch {
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503 },
    );
  }

  if (!record || record.status !== 'pending') {
    return NextResponse.json(
      { error: 'Invalid or expired upload link' },
      { status: 400 },
    );
  }

  let formData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json(
      { error: 'No file provided' },
      { status: 400 },
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: 'File too large (max 10MB)' },
      { status: 400 },
    );
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Invalid file type. Accepted: JPG, PNG, GIF, PDF, MP4' },
      { status: 400 },
    );
  }

  try {
    const uploadsDir = join(process.cwd(), '../../uploads');
    await mkdir(uploadsDir, { recursive: true });

    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${token}_${sanitizedName}`;
    const filePath = join(uploadsDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    await db
      .update(evidence)
      .set({
        fileName: file.name,
        fileUrl: `/uploads/${fileName}`,
        status: 'uploaded',
      })
      .where(eq(evidence.uploadToken, token));

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Upload failed. Please try again.' },
      { status: 500 },
    );
  }
}
