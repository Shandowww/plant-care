import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppearance } from "./appearance";

afterEach(() => {
  cleanup();
  localStorage.removeItem("plantcare.appearance");
  vi.unstubAllGlobals();
});

describe("device appearance", () => {
  it("follows system changes and remembers an explicit override", () => {
    let dark = false;
    let changed = () => {};
    const remove = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      get matches() { return dark; },
      addEventListener: (_event: string, listener: () => void) => { changed = listener; },
      removeEventListener: remove,
    })));
    const hook = renderHook(useAppearance);
    expect(hook.result.current[0]).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    dark = true;
    act(() => changed());
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => hook.result.current[1]("light"));
    act(() => changed());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("plantcare.appearance")).toBe("light");
    hook.unmount();
    expect(remove).toHaveBeenCalled();
    const next = renderHook(useAppearance);
    expect(next.result.current[0]).toBe("light");
  });

  it("ignores invalid saved preferences", () => {
    localStorage.setItem("plantcare.appearance", "invalid");
    expect(renderHook(useAppearance).result.current[0]).toBe("system");
  });
});
