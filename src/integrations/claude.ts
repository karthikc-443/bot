import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { TimelineComment } from "./devrev";

const anthropic = config.anthropic.apiKey ? new Anthropic({ apiKey: config.anthropic.apiKey }) : null;

export interface BlockerAnalysis {
  blockerEmail: string | null;
  summary: string;
}

const REPORT_TOOL = {
  name: "report_blocker_analysis",
  description: "Report who this ticket is currently blocked on and a one-line status summary.",
  input_schema: {
    type: "object" as const,
    properties: {
      blocker_email: {
        type: "string",
        description:
          "Email of whoever the ticket is currently waiting on, copied exactly from an email seen in the comments. Empty string if you can't confidently tell from the context.",
      },
      summary: {
        type: "string",
        description: "One sentence: current status and what's blocking progress.",
      },
    },
    required: ["blocker_email", "summary"],
  },
};

export function isEnabled(): boolean {
  return anthropic !== null;
}

export async function analyzeBlocker(input: {
  ticketTitle: string;
  devrevComments: TimelineComment[];
  slackThreadText: string;
  creatorEmail: string | null;
}): Promise<BlockerAnalysis | null> {
  if (!anthropic) return null;

  const commentsText = input.devrevComments
    .map((c) => `[${c.authorEmail ?? c.authorName}]: ${c.body}`)
    .join("\n\n");

  const prompt = `Ticket: ${input.ticketTitle}
${input.creatorEmail ? `Ticket creator/reporter (never the blocker — they're the one waiting): ${input.creatorEmail}` : ""}

DevRev comments (chronological):
${commentsText || "(none)"}

Slack thread:
${input.slackThreadText || "(none)"}

Who is this ticket currently blocked on — i.e. whose action is the next thing that needs to happen?

Rules for reading the most recent activity:
- Someone *asking* for a status update ("any update?", "when can this be fixed?") is never the blocker — they're the one waiting on someone else, usually whoever they addressed the question to.
- Someone stating a commitment or next step ("I will...", "I'll check...", "will raise a...") IS the blocker — the action is now on them until they follow through.
- The ticket creator/reporter is never the blocker.

Use report_blocker_analysis to answer.`;

  try {
    const response = await anthropic.messages.create({
      model: config.anthropic.model,
      max_tokens: 300,
      tools: [REPORT_TOOL],
      tool_choice: { type: "tool", name: REPORT_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;

    const result = toolUse.input as { blocker_email: string; summary: string };
    return {
      blockerEmail: result.blocker_email?.trim() || null,
      summary: result.summary,
    };
  } catch (err) {
    console.error("Claude blocker analysis failed", err);
    return null;
  }
}
