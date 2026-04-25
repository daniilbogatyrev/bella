import { NextResponse } from 'next/server';

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

export async function POST(req: Request) {
  let body: { to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { to } = body;

  if (!to || !E164_REGEX.test(to)) {
    return NextResponse.json(
      { error: 'A valid E.164 phone number is required (e.g. +15551234567)' },
      { status: 400 }
    );
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const publicUrl =
    process.env.PUBLIC_URL || process.env.WS_SERVER_URL || 'http://localhost:8080';

  if (!accountSid || !apiKeySid || !apiKeySecret || !from) {
    return NextResponse.json(
      { error: 'Twilio credentials are not configured on the server' },
      { status: 500 }
    );
  }

  const wsUrl = publicUrl.replace(/^http/, 'ws');
  const twiml = `<Response><Connect><Stream url="${wsUrl}/ws/stream" /></Connect></Response>`;

  const auth = Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString('base64');

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Twiml: twiml,
      }).toString(),
    }
  );

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: data.message || 'Failed to initiate call' },
      { status: res.status }
    );
  }

  return NextResponse.json({ callSid: data.sid, status: data.status });
}
