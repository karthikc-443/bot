import { extractCreatorSlackUserId, extractDevRevTicketId } from "../src/integrations/slack";

// Real text from DevRev's auto-posted Slack card (captured from ISS-3658725).
const REAL_CARD_TEXT = `New PSE Issue Created
<https://app.devrev.ai/razorpay/issue/ISS-3658725|*[ISS-3658725]*> Merchant Reported Missing Transfer
*Created by:* <@U0B4J4HTY3E|Karthik C>
*On:* <!date^1788500938^{date_short}, {time}|N/A>
*Owner:* <@U03BTNU0UCT|Bharath>`;

describe("extractDevRevTicketId", () => {
  it("pulls the ticket id out of the real DevRev card link format", () => {
    expect(extractDevRevTicketId(REAL_CARD_TEXT)).toBe("ISS-3658725");
  });
});

describe("extractCreatorSlackUserId", () => {
  it("matches through the bold-markdown asterisk between the colon and the mention", () => {
    expect(extractCreatorSlackUserId(REAL_CARD_TEXT)).toBe("U0B4J4HTY3E");
  });

  it("returns null when there's no Created by line", () => {
    expect(extractCreatorSlackUserId("no creator info here")).toBeNull();
  });
});
