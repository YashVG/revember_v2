import { describe, expect, test, vi } from "vitest";
import { preventWindowUnload, runBeforeLeaveGuards, runGuardedTransition } from "../src/renderer/src/navigationGuard";

describe("renderer before-leave guards", () => {
  test("runs registered guards in order before allowing navigation", async () => {
    const order: string[] = [];
    const allowed = await runBeforeLeaveGuards([
      async () => { order.push("save"); return true; },
      () => { order.push("confirm"); return true; }
    ]);

    expect(allowed).toBe(true);
    expect(order).toEqual(["save", "confirm"]);
  });

  test("blocks navigation immediately after a guard declines", async () => {
    const skipped = vi.fn(() => true);

    await expect(runBeforeLeaveGuards([() => false, skipped])).resolves.toBe(false);
    expect(skipped).not.toHaveBeenCalled();
  });

  test("fails closed when a guard throws", async () => {
    await expect(runBeforeLeaveGuards([() => { throw new Error("save failed"); }])).resolves.toBe(false);
  });

  test("marks a dirty window unload for native confirmation", () => {
    const event = {
      preventDefault: vi.fn(),
      returnValue: "unchanged"
    } as unknown as BeforeUnloadEvent;

    preventWindowUnload(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe("");
  });

  test("guards view changes and treats the active view as a no-op", async () => {
    const apply = vi.fn();
    const guard = vi.fn(async () => true);

    await expect(runGuardedTransition("questions", "questions", guard, apply)).resolves.toBe(false);
    expect(guard).not.toHaveBeenCalled();

    await expect(runGuardedTransition("questions", "overview", async () => false, apply)).resolves.toBe(false);
    expect(apply).not.toHaveBeenCalled();

    await expect(runGuardedTransition("questions", "overview", guard, apply)).resolves.toBe(true);
    expect(apply).toHaveBeenCalledWith("overview");
  });
});
