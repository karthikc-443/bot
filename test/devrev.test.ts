import { isClosed, DevRevWork } from "../src/integrations/devrev";

function work(stateIsFinal: boolean, stageName: string | null = null): DevRevWork {
  return {
    id: "don:core:1",
    displayId: "ISS-1",
    title: "test",
    stageName,
    stateIsFinal,
    ownerEmail: null,
    freshdeskTicketId: null,
    raw: {},
  };
}

describe("isClosed", () => {
  it("treats a final state as closed, regardless of stage name", () => {
    expect(isClosed(work(true, "Closed"))).toBe(true);
    expect(isClosed(work(true, "Resolved"))).toBe(true);
  });

  it("treats a non-final state as not closed", () => {
    expect(isClosed(work(false, "Under Investigation"))).toBe(false);
    expect(isClosed(work(false, "Triage"))).toBe(false);
  });
});
