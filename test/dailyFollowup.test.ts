import { decide, pickBlockerEmail, shouldNag } from "../src/jobs/dailyFollowup";
import { DevRevWork } from "../src/integrations/devrev";
import { FreshdeskConversation } from "../src/integrations/freshdesk";
import { BlockerAnalysis } from "../src/integrations/claude";

function work(stateIsFinal: boolean, stageName = "Open"): DevRevWork {
  return {
    id: "don:core:1",
    displayId: "ISS-1",
    title: "test",
    stageName,
    stateIsFinal,
    ownerEmail: "owner@example.com",
    freshdeskTicketId: "55",
    raw: {},
  };
}

function agentReplied(fromAgent: boolean): FreshdeskConversation[] {
  return [{ id: 1, createdAt: "2026-01-01T00:00:00Z", fromAgent }];
}

const PENDING_ON_PSE = 24;
const CLOSED_STATUS = 5;

describe("decide", () => {
  it("nags the blocker while DevRev ticket is open, regardless of Freshdesk state", () => {
    expect(decide(work(false, "Under Investigation"), agentReplied(true), CLOSED_STATUS)).toEqual({
      action: "nag_blocker",
      waitingOnMerchantReply: false,
    });
  });

  it("nags the blocker and flags merchant-waiting when closed in DevRev but customer has the last Freshdesk word", () => {
    expect(decide(work(true, "Closed"), agentReplied(false), CLOSED_STATUS)).toEqual({
      action: "nag_blocker",
      waitingOnMerchantReply: true,
    });
  });

  it("resolves only when closed in DevRev AND agent replied last on Freshdesk", () => {
    expect(decide(work(true, "Closed"), agentReplied(true), CLOSED_STATUS)).toEqual({ action: "resolved" });
  });

  it("gates on DevRev status alone when there's no linked Freshdesk ticket", () => {
    expect(decide(work(true, "Closed"), null, null)).toEqual({ action: "resolved" });
    expect(decide(work(false, "Under Investigation"), null, null)).toEqual({
      action: "nag_blocker",
      waitingOnMerchantReply: false,
    });
  });

  it("keeps nagging the blocker after a reopen even though it was previously closed", () => {
    // Simulates: ticket closed once, then reopened — stage.state.is_final flips back to false.
    expect(decide(work(false, "Triage"), agentReplied(true), CLOSED_STATUS)).toEqual({
      action: "nag_blocker",
      waitingOnMerchantReply: false,
    });
  });

  it("nags the creator when DevRev is closed but Freshdesk is Pending on PSE, even if the last reply was from an agent", () => {
    expect(decide(work(true, "Closed"), agentReplied(true), PENDING_ON_PSE)).toEqual({
      action: "nag_creator",
    });
  });

  it("does not check Pending on PSE while DevRev is still open", () => {
    expect(decide(work(false, "Triage"), agentReplied(true), PENDING_ON_PSE)).toEqual({
      action: "nag_blocker",
      waitingOnMerchantReply: false,
    });
  });
});

describe("pickBlockerEmail", () => {
  function analysis(blockerEmail: string | null): BlockerAnalysis {
    return { blockerEmail, summary: "test summary" };
  }

  it("prefers Claude's identified blocker over the plain DevRev assignee", () => {
    expect(pickBlockerEmail(work(false), analysis("blocker@example.com"))).toBe("blocker@example.com");
  });

  it("falls back to the DevRev assignee when analysis found no confident blocker", () => {
    expect(pickBlockerEmail(work(false), analysis(null))).toBe("owner@example.com");
  });

  it("falls back to the DevRev assignee when analysis is disabled/unavailable", () => {
    expect(pickBlockerEmail(work(false), null)).toBe("owner@example.com");
  });
});

describe("shouldNag", () => {
  const now = new Date("2026-01-01T12:00:00Z");

  it("does not nag when the last response was under the threshold ago", () => {
    const lastResponseAt = new Date("2026-01-01T06:00:00Z"); // 6h ago
    expect(shouldNag(now, lastResponseAt, null, 8)).toBe(false);
  });

  it("nags once the threshold has passed since the last response", () => {
    const lastResponseAt = new Date("2026-01-01T04:00:00Z"); // 8h ago exactly
    expect(shouldNag(now, lastResponseAt, null, 8)).toBe(true);
  });

  it("does not re-nag within the threshold of our own last nag, even if the response is older", () => {
    const lastResponseAt = new Date("2026-01-01T00:00:00Z"); // 12h ago
    const lastFollowupAt = new Date("2026-01-01T10:00:00Z"); // we nagged 2h ago
    expect(shouldNag(now, lastResponseAt, lastFollowupAt, 8)).toBe(false);
  });

  it("nags again once the threshold has passed since our own last nag", () => {
    const lastResponseAt = new Date("2025-12-31T12:00:00Z"); // 24h ago
    const lastFollowupAt = new Date("2026-01-01T04:00:00Z"); // our last nag, 8h ago
    expect(shouldNag(now, lastResponseAt, lastFollowupAt, 8)).toBe(true);
  });

  it("resets the clock on a response that's newer than our last nag", () => {
    const lastFollowupAt = new Date("2026-01-01T03:00:00Z"); // 9h ago — would nag alone
    const lastResponseAt = new Date("2026-01-01T11:00:00Z"); // but someone replied 1h ago
    expect(shouldNag(now, lastResponseAt, lastFollowupAt, 8)).toBe(false);
  });

  it("supports a tighter threshold, e.g. the 1h creator-nag cadence", () => {
    const lastResponseAt = new Date("2026-01-01T10:30:00Z"); // 1.5h ago
    expect(shouldNag(now, lastResponseAt, null, 1)).toBe(true);
    expect(shouldNag(now, new Date("2026-01-01T11:30:00Z"), null, 1)).toBe(false); // 30m ago
  });
});
