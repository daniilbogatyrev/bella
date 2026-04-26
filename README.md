<div align="center">

# 🐝 Bella — AI Voice Agent for Insurance

**A fully autonomous, phone-based AI agent that handles insurance customer calls over real phone lines.**

Built with real-time speech-to-speech, tool-calling, mid-call SMS, and a full admin dashboard.

[![Bun](https://img.shields.io/badge/Bun-1.x-f9f1e1?logo=bun&logoColor=000)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=fff)](https://www.typescriptlang.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-000?logo=nextdotjs&logoColor=fff)](https://nextjs.org)
[![Twilio](https://img.shields.io/badge/Twilio-Voice+SMS-f22f46?logo=twilio&logoColor=fff)](https://www.twilio.com)
[![ElevenLabs](https://img.shields.io/badge/ElevenLabs-ConvAI-000?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiPjxyZWN0IHg9IjYiIHk9IjQiIHdpZHRoPSI0IiBoZWlnaHQ9IjE2IiBmaWxsPSIjZmZmIi8+PHJlY3QgeD0iMTQiIHk9IjQiIHdpZHRoPSI0IiBoZWlnaHQ9IjE2IiBmaWxsPSIjZmZmIi8+PC9zdmc+)](https://elevenlabs.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=fff)](https://www.postgresql.org)
[![License](https://img.shields.io/badge/License-Hackathon_Project-yellow)]()

---

📞 **Try it live:** Call **+49 30 7567 6653** (German number)

</div>

---

## 📖 What Is Bella?

Bella is a human-sounding AI voice agent for **SafeGuard Insurance** that answers real inbound phone calls. Customers call a real German phone number, and Bella handles the entire conversation — from greeting them by name to filing claims, requesting photo evidence via SMS, and even upselling additional coverage.

She sounds natural, speaks multiple languages, never reveals she's an AI, and documents everything in a PostgreSQL database with full transcripts and summaries accessible from an admin dashboard.

### ✨ Key Capabilities

| Feature | Description |
|---|---|
| 📞 **Inbound calls** | Accepts calls on a real phone number via Twilio |
| 🎙️ **Speech-to-speech** | Real-time voice conversation via ElevenLabs Conversational AI |
| 👤 **Caller identification** | Auto-identifies customers by phone number, greets by name |
| 📋 **Claims processing** | Opens and manages insurance claims through natural conversation |
| 📸 **Evidence collection** | Sends SMS mid-call with upload link for photos/documents |
| 📍 **Geolocation capture** | Records location data on evidence upload |
| 💰 **Smart upselling** | Recommends relevant insurance products (auto, health, home, life, travel, liability) |
| 🗂️ **Policy lookup** | Retrieves and discusses the caller's current insurance plans |
| 📝 **Full documentation** | Saves transcripts, call summaries, and timeline events |
| 🌍 **Multilingual** | English, German, and Spanish with mid-call language switching |
| 🔄 **Continuity** | If a caller rings back with an open claim, picks up where they left off |
| 🤫 **Indistinguishable** | Never reveals it's an AI — sounds fully human |

---

## 🏗️ Architecture

```
┌──────────────┐         ┌──────────────────────────────┐
│              │  PSTN    │          Twilio               │
│   Customer   │ ──────► │  (Voice + Media Streams)      │
│   ☎️  Phone   │ ◄────── │  (SMS for evidence links)     │
│              │         └───────────┬──────────────────┘
└──────────────┘                     │ WebSocket
                                     ▼
                         ┌──────────────────────────────┐
                         │     Bun WS Server (Hono)      │
                         │                                │
                         │  ┌─── Audio Pipeline ───────┐  │
                         │  │ Twilio mulaw 8kHz         │  │
                         │  │   ↕ PCM 16kHz conversion  │  │
                         │  │ ElevenLabs ConvAI         │  │
                         │  └──────────────────────────┘  │
                         │                                │
                         │  ┌─── 9 Agent Tools ────────┐  │
                         │  │ lookup_customer           │  │
                         │  │ get_policies              │  │
                         │  │ open_claim                │  │
                         │  │ log_fact                  │  │
                         │  │ request_evidence (→ SMS)  │  │
                         │  │ upsell_product            │  │
                         │  │ request_callback          │  │
                         │  │ end_call                  │  │
                         │  │ change_language            │  │
                         │  └──────────────────────────┘  │
                         └───────────┬──────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
          ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
          │  PostgreSQL   │  │  ElevenLabs   │  │  Twilio SMS  │
          │  (Drizzle)    │  │  ConvAI API   │  │  (Evidence)  │
          └──────┬───────┘  └──────────────┘  └──────────────┘
                 │
                 ▼
          ┌──────────────────────────────┐
          │    Next.js 15 Dashboard       │
          │    (Tailwind + shadcn/ui)     │
          │                               │
          │  /dashboard  — Overview stats │
          │  /calls      — Call list       │
          │  /calls/:id  — Call detail     │
          │  /claims     — Claims mgmt    │
          │  /claims/:id — Claim detail   │
          │  /customers  — Customer mgmt  │
          │  /settings   — Admin panel     │
          │  /upload/:t  — Evidence upload │
          └──────────────────────────────┘
```

### 🔊 Audio Pipeline

```
Caller → Twilio (mulaw 8kHz) → [ mulaw → PCM 16kHz ] → ElevenLabs ConvAI
ElevenLabs ConvAI → [ PCM 16kHz → mulaw 8kHz ] → Twilio → Caller
```

- **Voice:** Jessica (ElevenLabs `eleven_flash_v2`) — premium, human-sounding
- **Background noise:** Optional call-center ambiance mixed behind Bella's voice for realism

---

## 📁 Project Structure

```
bella/
├── apps/
│   ├── ws-server/              # Bun WebSocket server — Twilio ↔ ElevenLabs bridge
│   │   └── src/
│   │       ├── index.ts        # HTTP + WebSocket server (Hono)
│   │       ├── conversational-ai.ts  # ElevenLabs ConvAI session manager
│   │       ├── tools.ts        # 9 agent tool handlers
│   │       ├── prompt.ts       # Bella's system prompt & persona
│   │       ├── session.ts      # Per-call session state
│   │       ├── setup-agent.ts  # ElevenLabs agent provisioning script
│   │       └── db.ts           # Database queries for the ws-server
│   └── web/                    # Next.js 15 admin dashboard
│       └── src/
│           ├── app/
│           │   ├── (dashboard)/ # Authenticated routes
│           │   │   ├── dashboard/    # Overview stats
│           │   │   ├── calls/        # Call list + call detail
│           │   │   ├── claims/       # Claims management
│           │   │   ├── customers/    # Customer management
│           │   │   └── settings/     # Admin settings
│           │   ├── (public)/
│           │   │   └── upload/[token]/ # Public evidence upload
│           │   ├── login/      # Google OAuth + email/password
│           │   └── page.tsx    # Public landing page
│           └── lib/            # Auth, DB, utilities
├── packages/
│   └── db/                     # Shared Drizzle ORM schema + client
│       └── src/
│           ├── schema/         # Tables: customers, policies, claims,
│           │                   #   call-sessions, transcripts, evidence,
│           │                   #   claim-events, admin-users
│           ├── client.ts       # PostgreSQL connection
│           └── seed.ts         # Demo data seeder
├── dev.ts                      # One-command dev startup (ngrok + Twilio + servers)
├── .env.example                # All required environment variables
└── package.json                # Bun workspace root
```

---

## 🛠️ Agent Tools

Bella uses **9 client tools** that the AI can invoke mid-conversation to take real actions:

| # | Tool | Description |
|---|---|---|
| 1 | `lookup_customer` | Look up a customer by phone number, name, or date of birth |
| 2 | `get_policies` | Retrieve the caller's active insurance policies |
| 3 | `open_claim` | Open a new insurance claim (auto, health, liability, etc.) |
| 4 | `log_fact` | Record facts about the incident (queued if no claim yet, flushed on claim open) |
| 5 | `request_evidence` | Send SMS to the caller with an upload link for photos/documents |
| 6 | `upsell_product` | Recommend additional insurance products with reasoning |
| 7 | `request_callback` | Schedule a specialist callback at a preferred time |
| 8 | `end_call` | Gracefully end the conversation |
| 9 | `change_language` | Switch the conversation language and voice (en/de/es) |

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) (v1.x)
- [Docker](https://docs.docker.com/get-docker/) (for PostgreSQL)
- [Twilio](https://www.twilio.com) account with a phone number
- [ElevenLabs](https://elevenlabs.io) API key
- [ngrok](https://ngrok.com) account (2 auth tokens for dual tunnels)

### 1. Clone & Install

```bash
git clone <repo-url> bella
cd bella
bun install
```

### 2. Environment Setup

```bash
cp .env.example .env
```

Fill in your `.env` with:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID |
| `TWILIO_API_KEY_SID` | Twilio API Key SID |
| `TWILIO_API_KEY_SECRET` | Twilio API Key Secret |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number |
| `TWILIO_SMS_PHONE_NUMBER` | Number used to send SMS |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `NGROK_AUTHTOKENS` | Comma-separated ngrok auth tokens (need 2) |
| `NEXTAUTH_SECRET` | Random secret for NextAuth sessions |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |

### 3. Database

Start PostgreSQL with Docker:

```bash
docker run -d \
  --name bella-db \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=bella \
  -p 5432:5432 \
  postgres:16
```

Push the schema and seed demo data:

```bash
bun run db:migrate
bun run db:seed
```

### 4. Provision the ElevenLabs Agent

```bash
cd apps/ws-server
bun run setup-agent
```

This creates the Conversational AI agent on ElevenLabs with Bella's persona, voice, and tool definitions.

### 5. Run Everything

```bash
bun run dev
```

This single command:
1. ✅ Installs dependencies
2. ✅ Pushes DB schema
3. ✅ Starts two ngrok tunnels (WS server + dashboard)
4. ✅ Updates the Twilio webhook automatically
5. ✅ Starts the WebSocket server (port 8080)
6. ✅ Starts the Next.js dashboard (port 3000)

You'll see:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🐝 Bella Insurance Agent — Dev Environment
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 Phone:     +493075676653
🌐 WS Tunnel: https://xxxx.ngrok-free.app
🌐 Dashboard: https://xxxx.ngrok-free.app
🔌 WS Local:  http://localhost:8080
💻 Web Local:  http://localhost:3000
🔗 Webhook:   https://xxxx.ngrok-free.app/inbound/twiml
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Call the phone number and talk to Bella!** 🐝

---

## 🖥️ Dashboard

The Next.js admin dashboard provides full visibility into Bella's activity:

| Route | Description |
|---|---|
| `/` | Public landing page |
| `/login` | Google OAuth + email/password authentication |
| `/dashboard` | Overview stats (calls, claims, customers) |
| `/calls` | Call list with status and duration |
| `/calls/:id` | Detailed call view with transcript timeline |
| `/claims` | Claims management with filtering |
| `/claims/:id` | Claim detail with evidence gallery |
| `/customers` | Customer management with policy multi-select |
| `/customers/:id` | Customer detail with call/claim history |
| `/settings` | Admin user management |
| `/upload/:token` | Public evidence upload page (sent via SMS to callers) |

---

## 🎭 Bella's Persona

> **Name:** Bella from SafeGuard Insurance
> **Voice:** Jessica (ElevenLabs premium voice — `eleven_flash_v2`)
> **Personality:** Warm, professional, empathetic, concise (1–2 sentences max)
> **Languages:** English 🇬🇧 · German 🇩🇪 · Spanish 🇪🇸

### Conversation Flow

1. **Greeting** — Identifies the caller, greets returning customers by name
2. **Intent** — Understands what the customer needs (new claim, policy question, etc.)
3. **Claim opening** — Gathers details through natural conversation, opens the claim
4. **Evidence** — Sends SMS with upload link so the caller can snap photos mid-call
5. **Upselling** — Opportunistically recommends relevant additional coverage
6. **Wrap-up** — Summarizes next steps, never hangs up until the customer says goodbye

---

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| **Runtime** | [Bun](https://bun.sh) |
| **Language** | [TypeScript](https://www.typescriptlang.org) |
| **Telephony** | [Twilio](https://www.twilio.com) — Voice, Media Streams, SMS |
| **Speech-to-Speech** | [ElevenLabs Conversational AI](https://elevenlabs.io) — Agent API with client tools |
| **Voice** | Jessica (`eleven_flash_v2`) — premium, human-sounding |
| **WS Server** | [Bun](https://bun.sh) + [Hono](https://hono.dev) |
| **Frontend** | [Next.js 15](https://nextjs.org) (App Router) + [Tailwind CSS](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com) |
| **Auth** | [NextAuth](https://next-auth.js.org) — Google OAuth + email/password |
| **Database** | [PostgreSQL 16](https://www.postgresql.org) + [Drizzle ORM](https://orm.drizzle.team) |
| **Tunneling** | [ngrok](https://ngrok.com) (dual tunnels for WS + dashboard) |

---

## 🏆 Built At

> **Berlin Hackathon 2026** 🇩🇪
>
> Bella was built as a hackathon project to demonstrate what's possible when you combine
> real-time voice AI with telephony infrastructure — a fully autonomous insurance agent
> that can handle calls end-to-end without any human in the loop.

---

## 📄 License

Hackathon project — built for demo purposes.
