import { decide } from "../src/jobs/dailyFollowup";
import { DevRevWork } from "../src/integrations/devrev";
import { FreshdeskConversation } from "../src/integrations/freshdesk";

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

describe("decide", () => {
  it("nags while DevRev ticket is open, regardless of Freshdesk state", () => {
    expect(decide(work(false, "Under Investigation"), agentReplied(true))).toEqual({
      action: "nag",
      waitingOnMerchantReply: false,
    });
  });

  it("nags and flags merchant-waiting when closed in DevRev but customer has the last Freshdesk word", () => {
    expect(decide(work(true, "Closed"), agentReplied(false))).toEqual({
      action: "nag",
      waitingOnMerchantReply: true,
    });
  });

  it("resolves only when closed in DevRev AND agent replied last on Freshdesk", () => {
    expect(decide(work(true, "Closed"), agentReplied(true))).toEqual({ action: "resolved" });
  });

  it("gates on DevRev status alone when there's no linked Freshdesk ticket", () => {
    expect(decide(work(true, "Closed"), null)).toEqual({ action: "resolved" });
    expect(decide(work(false, "Under Investigation"), null)).toEqual({
      action: "nag",
      waitingOnMerchantReply: false,
    });
  });

  it("keeps nagging after a reopen even though it was previously closed", () => {
    // Simulates: ticket closed once, then reopened — stage.state.is_final flips back to false.
    expect(decide(work(false, "Triage"), agentReplied(true))).toEqual({
      action: "nag",
      waitingOnMerchantReply: false,
    });
  });
});
