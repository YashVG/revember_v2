import { describe, expect, test, vi } from "vitest";
import { isKnowledgeRootChangeAllowed, runGuardedKnowledgeRootChange } from "../src/renderer/src/knowledgeRootChange";

describe("renderer knowledge-root changes", () => {
  test("allows root switching only from an idle Home view", () => {
    expect(isKnowledgeRootChangeAllowed("home", false)).toBe(true);
    // Active review or checkpoint/editor overlays are root-scoped even when Home is underneath.
    expect(isKnowledgeRootChangeAllowed("home", true)).toBe(false);
    expect(isKnowledgeRootChangeAllowed("topic", false)).toBe(false);
  });

  test("does not change roots when the current workflow cannot be closed", async () => {
    const change = vi.fn(async () => "new-root");

    await expect(runGuardedKnowledgeRootChange(async () => false, change)).resolves.toEqual({ changed: false });
    expect(change).not.toHaveBeenCalled();
  });

  test("saves before changing roots", async () => {
    const order: string[] = [];

    const result = await runGuardedKnowledgeRootChange(
      async () => {
        order.push("save");
        return true;
      },
      async () => {
        order.push("change");
        return "new-root";
      }
    );

    expect(order).toEqual(["save", "change"]);
    expect(result).toEqual({ changed: true, snapshot: "new-root" });
  });
});
