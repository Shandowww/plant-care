import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationSettings } from "./NotificationSettings";
import * as api from "./api";

vi.mock("./api", () => ({
  getNotificationPreferences: vi.fn(async () => ({ devices: ["mobile_app_phone"], persistent: true })),
  getNotificationDevices: vi.fn(async () => ["mobile_app_phone"]),
  saveNotificationPreferences: vi.fn(),
  testNotificationDevices: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("tests selected devices without saving or claiming device receipt", async () => {
  vi.mocked(api.testNotificationDevices).mockResolvedValue({ accepted: ["mobile_app_phone"], failed: [] });
  render(<NotificationSettings enabled />);
  fireEvent.click(await screen.findByRole("button", { name: "Send test to selected devices" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Home Assistant accepted the test");
  expect(screen.getByRole("status")).toHaveTextContent("receipt cannot be confirmed here");
  expect(api.saveNotificationPreferences).not.toHaveBeenCalled();
});

it("reports failed devices and re-enables the test control", async () => {
  vi.mocked(api.testNotificationDevices).mockResolvedValue({ accepted: [], failed: ["mobile_app_phone"] });
  render(<NotificationSettings enabled />);
  fireEvent.click(await screen.findByRole("button", { name: "Send test to selected devices" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Home Assistant could not send to: mobile_app_phone");
  expect(screen.getByRole("button", { name: "Send test to selected devices" })).toBeEnabled();
});

it("disables testing while delivery is disabled", async () => {
  render(<NotificationSettings enabled={false} />);
  expect(await screen.findByRole("button", { name: "Send test to selected devices" })).toBeDisabled();
});
