#!/usr/bin/env bun
/**
 * Creates (or updates) the ElevenLabs Conversational AI agent for Bella.
 *
 * Run once:
 *   bun run --env-file .env --env-file ../../.env src/setup-agent.ts
 *
 * Outputs the `agent_id` to add to your .env as ELEVENLABS_AGENT_ID.
 * If ELEVENLABS_AGENT_ID is already set, updates the existing agent instead.
 */

import { BELLA_SYSTEM_PROMPT } from "./prompt.ts";
import { TOOL_DEFINITIONS } from "./llm.ts";
import { VOICE_MAP } from "./elevenlabs-tts.ts";

const API_BASE = "https://api.elevenlabs.io/v1/convai";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("❌ ELEVENLABS_API_KEY is required. Set it in .env");
  process.exit(1);
}

const existingAgentId = process.env.ELEVENLABS_AGENT_ID;

function buildClientTools(): Array<Record<string, unknown>> {
  return TOOL_DEFINITIONS.map((t) => ({
    type: "client",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

function buildAgentConfig(): Record<string, unknown> {
  const defaultVoice = VOICE_MAP.en;

  return {
    name: "Bella Insurance Agent",
    conversation_config: {
      agent: {
        prompt: {
          prompt: BELLA_SYSTEM_PROMPT,
          tools: buildClientTools(),
        },
        first_message:
          "Hi there, this is Bella from SafeGuard Insurance. How can I help you today?",
      },
      tts: {
        voice_id: defaultVoice.voiceId,
        model_id: "eleven_flash_v2",
      },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: {
            prompt: {
              prompt: true,
            },
            first_message: true,
            language: true,
          },
          tts: {
            voice_id: true,
          },
        },
      },
    },
  };
}

async function createAgent(): Promise<string> {
  const config = buildAgentConfig();

  console.log("[BELLA:SETUP] Creating new ElevenLabs agent...");

  const res = await fetch(`${API_BASE}/agents/create`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ Agent creation failed (${res.status}): ${body}`);
    process.exit(1);
  }

  const data = (await res.json()) as { agent_id: string };
  return data.agent_id;
}

async function updateAgent(agentId: string): Promise<void> {
  const config = buildAgentConfig();

  console.log(`[BELLA:SETUP] Updating existing agent ${agentId}...`);

  const res = await fetch(`${API_BASE}/agents/${agentId}`, {
    method: "PATCH",
    headers: {
      "xi-api-key": apiKey!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`❌ Agent update failed (${res.status}): ${body}`);
    process.exit(1);
  }

  console.log(`✅ Agent ${agentId} updated successfully.`);
}

async function main(): Promise<void> {
  if (existingAgentId) {
    await updateAgent(existingAgentId);
    console.log(`\nAgent ID (unchanged): ${existingAgentId}`);
  } else {
    const agentId = await createAgent();
    console.log(`\n✅ Agent created successfully!`);
    console.log(`\nAgent ID: ${agentId}`);
    console.log(`\nAdd this to your .env file:`);
    console.log(`  ELEVENLABS_AGENT_ID=${agentId}`);
  }
}

main().catch((err) => {
  console.error("❌ Setup failed:", err);
  process.exit(1);
});
