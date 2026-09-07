import { isResolvedForMerchant, FreshdeskConversation } from "../src/integrations/freshdesk";

function conv(id: number, createdAt: string, fromAgent: boolean): FreshdeskConversation {
  return { id, createdAt, fromAgent };
}

describe("isResolvedForMerchant", () => {
  it("is unresolved with no conversations", () => {
    expect(isResolvedForMerchant([])).toBe(false);
  });

  it("is resolved when the latest conversation is from an agent", () => {
    const conversations = [
      conv(1, "2026-01-01T00:00:00Z", false),
      conv(2, "2026-01-02T00:00:00Z", true),
    ];
    expect(isResolvedForMerchant(conversations)).toBe(true);
  });

  it("is unresolved when the latest conversation is from the customer", () => {
    const conversations = [
      conv(1, "2026-01-01T00:00:00Z", true),
      conv(2, "2026-01-02T00:00:00Z", false),
    ];
    expect(isResolvedForMerchant(conversations)).toBe(false);
  });

  it("is order-independent — sorts by createdAt before checking the latest", () => {
    const conversations = [
      conv(2, "2026-01-02T00:00:00Z", false),
      conv(1, "2026-01-01T00:00:00Z", true),
    ];
    expect(isResolvedForMerchant(conversations)).toBe(false);
  });
});
