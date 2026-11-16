// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORT_PAID_SNOOZE_DAYS, SUPPORT_SNOOZE_DAYS } from "./support-config";
import { OPEN_DELAY_MS, closeSupport, dismissSupport, markSupported, requestSupport, resetSupportForTests, useSupport } from "./support-store";

// Exercise the modal's logic even while the feature switch is off in support-config.
vi.mock("./support-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./support-config")>()),
  supportEnabled: true,
}));

const DAY = 24 * 60 * 60 * 1000;
const KEY = "cleanframe.support.snoozedUntil";
const impact = { images: 2, fieldsRemoved: 31, location: true };

describe("support modal state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    resetSupportForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("opens a beat after a download, with the user's real impact", () => {
    const { result } = renderHook(() => useSupport());
    act(() => requestSupport(impact));
    // Not instantly: the download gets to show first.
    expect(result.current.open).toBe(false);
    act(() => vi.advanceTimersByTime(OPEN_DELAY_MS));
    expect(result.current).toEqual({ open: true, impact });
  });

  it("several downloads in a row open it once", () => {
    const { result } = renderHook(() => useSupport());
    act(() => {
      requestSupport(impact);
      requestSupport({ images: 1, fieldsRemoved: 3, location: false });
    });
    act(() => vi.advanceTimersByTime(OPEN_DELAY_MS));
    expect(result.current.impact).toEqual(impact);
  });

  it("dismissing snoozes it on this device", () => {
    const { result } = renderHook(() => useSupport());
    act(() => requestSupport(impact));
    act(() => vi.advanceTimersByTime(OPEN_DELAY_MS));
    const now = Date.now();
    act(() => dismissSupport(now));
    expect(result.current.open).toBe(false);
    expect(Number(window.localStorage.getItem(KEY))).toBe(now + SUPPORT_SNOOZE_DAYS * DAY);
    act(() => requestSupport(impact));
    act(() => vi.advanceTimersByTime(OPEN_DELAY_MS));
    expect(result.current.open).toBe(false);
  });

  it("'I've sent it' snoozes for longer and keeps the modal open for the thank-you", () => {
    const { result } = renderHook(() => useSupport());
    act(() => requestSupport(impact));
    act(() => vi.advanceTimersByTime(OPEN_DELAY_MS));
    const now = Date.now();
    act(() => markSupported(now));
    expect(result.current.open).toBe(true);
    expect(Number(window.localStorage.getItem(KEY))).toBe(now + SUPPORT_PAID_SNOOZE_DAYS * DAY);
    act(() => closeSupport());
    expect(result.current.open).toBe(false);
  });

  it("comes back once a snooze has expired", () => {
    window.localStorage.setItem(KEY, String(Date.now() - 1));
    const { result } = renderHook(() => useSupport());
    act(() => requestSupport(impact));
    act(() => vi.advanceTimersByTime(OPEN_DELAY_MS));
    expect(result.current.open).toBe(true);
  });
});
