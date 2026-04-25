import ngrok from '@ngrok/ngrok';
import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';

// Load .env
config();

const WS_PORT = Number(process.env.WS_SERVER_PORT || 8080);

// ─── Step 1: Install deps ───
console.log('▸ Installing dependencies...');
execSync('bun install', { stdio: 'inherit', cwd: process.cwd() });
console.log('✓ Dependencies installed\n');

// ─── Step 2: Push DB schema ───
console.log('▸ Pushing database schema...');
try {
  execSync('bunx drizzle-kit push', {
    stdio: 'inherit',
    cwd: `${process.cwd()}/packages/db`,
    env: { ...process.env },
  });
  console.log('✓ Database schema pushed\n');
} catch (e) {
  console.error('⚠ Database push failed — continuing anyway\n');
}

// ─── Step 3: Start ngrok tunnels ───
console.log('▸ Starting ngrok tunnels...');
const tokens = (process.env.NGROK_AUTHTOKENS || '').split(',').filter(Boolean);

// Tunnel 1: WS server (port 8080)
let wsTunnelUrl: string | null = null;
let wsListener: ngrok.Listener | null = null;
let usedTokenIndex = -1;

for (let i = 0; i < tokens.length; i++) {
  try {
    console.log(`  [WS] Trying token: ${tokens[i]!.slice(0, 8)}...`);
    wsListener = await ngrok.connect({ addr: WS_PORT, authtoken: tokens[i]! });
    wsTunnelUrl = wsListener.url();
    if (wsTunnelUrl) {
      usedTokenIndex = i;
      console.log(`✓ WS tunnel established: ${wsTunnelUrl}`);
      break;
    }
  } catch (err: any) {
    console.log(`  ✗ Token failed: ${err.message}`);
  }
}

if (!wsTunnelUrl) {
  console.error('✗ All ngrok tokens failed for WS tunnel. Exiting.');
  process.exit(1);
}

// Tunnel 2: Dashboard (port 3000, must use a different token)
let dashTunnelUrl: string | null = null;
let dashListener: ngrok.Listener | null = null;

for (let i = 0; i < tokens.length; i++) {
  if (i === usedTokenIndex) continue;
  try {
    console.log(`  [Dashboard] Trying token: ${tokens[i]!.slice(0, 8)}...`);
    dashListener = await ngrok.connect({ addr: 3000, authtoken: tokens[i]! });
    dashTunnelUrl = dashListener.url();
    if (dashTunnelUrl) {
      console.log(`✓ Dashboard tunnel established: ${dashTunnelUrl}\n`);
      break;
    }
  } catch (err: any) {
    console.log(`  ✗ Token failed: ${err.message}`);
  }
}

if (!dashTunnelUrl) {
  console.warn('⚠ Could not start dashboard tunnel — upload links will use localhost:3000\n');
  dashTunnelUrl = 'http://localhost:3000';
}

// ─── Step 4: Update Twilio webhook ───
console.log('▸ Updating Twilio webhook...');
try {
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const apiKey = process.env.TWILIO_API_KEY_SID!;
  const apiSecret = process.env.TWILIO_API_KEY_SECRET!;
  const phoneNumber = encodeURIComponent(process.env.TWILIO_PHONE_NUMBER || '+493075676653');
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');

  // Find phone number SID
  const searchRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${phoneNumber}`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  const searchData = (await searchRes.json()) as any;
  const phoneSid = searchData.incoming_phone_numbers?.[0]?.sid;

  if (phoneSid) {
    // Update webhook URL
    const voiceUrl = `${wsTunnelUrl}/inbound/twiml`;
    const updateRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneSid}.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ VoiceUrl: voiceUrl, VoiceMethod: 'POST' }).toString(),
      },
    );
    if (updateRes.ok) {
      console.log(`✓ Twilio webhook → ${voiceUrl}\n`);
    } else {
      console.log(`⚠ Twilio update failed: ${updateRes.status}\n`);
    }
  } else {
    console.log('⚠ Phone number not found on Twilio account\n');
  }
} catch (err: any) {
  console.log(`⚠ Twilio update failed: ${err.message}\n`);
}

// ─── Step 5: Update .env PUBLIC_URL + DASHBOARD_PUBLIC_URL ───
const envPath = `${process.cwd()}/.env`;
let envContent = readFileSync(envPath, 'utf-8');
envContent = envContent.replace(/^PUBLIC_URL=.*/m, `PUBLIC_URL=${wsTunnelUrl}`);
if (envContent.match(/^DASHBOARD_PUBLIC_URL=.*/m)) {
  envContent = envContent.replace(/^DASHBOARD_PUBLIC_URL=.*/m, `DASHBOARD_PUBLIC_URL=${dashTunnelUrl}`);
} else {
  envContent += `\nDASHBOARD_PUBLIC_URL=${dashTunnelUrl}\n`;
}
writeFileSync(envPath, envContent);

// ─── Step 6: Print summary ───
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🐝 Bella Insurance Agent — Dev Environment');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📞 Phone:     ${process.env.TWILIO_PHONE_NUMBER || '+493075676653'}`);
console.log(`🌐 WS Tunnel: ${wsTunnelUrl}`);
console.log(`🌐 Dashboard: ${dashTunnelUrl}`);
console.log(`🔌 WS Local:  http://localhost:${WS_PORT}`);
console.log(`💻 Web Local:  http://localhost:3000`);
console.log(`🔗 Webhook:   ${wsTunnelUrl}/inbound/twiml`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Press x + Enter to stop\n');

// ─── Step 7: Start servers ───
const wsServer = spawn('bun', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true,
  cwd: `${process.cwd()}/apps/ws-server`,
  env: { ...process.env, PUBLIC_URL: wsTunnelUrl, DASHBOARD_PUBLIC_URL: dashTunnelUrl },
});

const webServer = spawn('bun', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true,
  cwd: `${process.cwd()}/apps/web`,
  env: { ...process.env, DASHBOARD_PUBLIC_URL: dashTunnelUrl },
});

// ─── Cleanup ───
const cleanup = () => {
  console.log('\n▸ Shutting down...');
  wsServer.kill();
  webServer.kill();
  wsListener?.close();
  dashListener?.close();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  if (data.toString().trim().toLowerCase() === 'x') {
    cleanup();
  }
});

wsServer.on('close', (code) => console.log(`WS server exited (${code})`));
webServer.on('close', (code) => console.log(`Web dashboard exited (${code})`));
