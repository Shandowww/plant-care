import { useEffect, useState } from "react";
import { getNotificationDevices, getNotificationPreferences, saveNotificationPreferences, testNotificationDevices } from "./api";
import type { NotificationPreferences } from "./api";

export function NotificationSettings({ enabled }: { enabled: boolean }) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([getNotificationPreferences(), getNotificationDevices()])
      .then(([saved, available]) => {
        if (active) { setPreferences(saved); setDevices(available); setMessage(""); }
      })
      .catch((reason: unknown) => {
        if (active) setMessage(reason instanceof Error ? reason.message : "Could not load devices.");
      });
    return () => { active = false; };
  }, [refresh]);
  async function save() {
    if (!preferences) return;
    setBusy(true);
    try {
      setPreferences(await saveNotificationPreferences(preferences));
      setMessage("Notification recipients saved. No restart needed. Changes apply to new alerts.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not save notification recipients.");
    } finally { setBusy(false); }
  }
  async function test() {
    if (!preferences) return;
    setBusy(true);
    setMessage("Sending test notification…");
    try {
      const result = await testNotificationDevices(preferences);
      setMessage([
        result.accepted.length ? `Home Assistant accepted the test for: ${result.accepted.join(", ")}. Check those devices; receipt cannot be confirmed here.` : "",
        result.failed.length ? `Home Assistant could not send to: ${result.failed.join(", ")}. Check the Companion app registration and Home Assistant logs, then retry.` : "",
        "If no notification appears, check notification permission and Focus / Do Not Disturb on the device. Testing does not save your selection.",
      ].filter(Boolean).join(" "));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not send test notification.");
    } finally { setBusy(false); }
  }
  return <>
    <p>Select phones or tablets registered with the Home Assistant Companion app, then save your selection. Only new alerts use the saved recipients; existing Home Assistant panel alerts are not sent again. Tap an alert to open the affected plant.</p>
    {!enabled && <p>Delivery is disabled. Enable home_assistant_notifications in add-on configuration and restart. The simulator never sends notifications.</p>}
    {preferences && <>
      {[...new Set([...devices, ...preferences.devices])].map(device => <label className="switch-row" key={device}>
        <span>{device.replace(/^mobile_app_/, "").replaceAll("_", " ")}{!devices.includes(device) ? " (currently unavailable)" : ""}</span>
        <input type="checkbox" checked={preferences.devices.includes(device)} disabled={busy}
          onChange={event => setPreferences({ ...preferences, devices: event.target.checked ? [...preferences.devices, device] : preferences.devices.filter(value => value !== device) })} />
      </label>)}
      {devices.length === 0 && <p>No mobile devices found. Sign in to the Companion app on each device and enable notifications, then refresh.</p>}
      <label className="switch-row"><span>Also show in Home Assistant notification panel</span>
        <input type="checkbox" checked={preferences.persistent} disabled={busy} onChange={event => setPreferences({ ...preferences, persistent: event.target.checked })} />
      </label>
      {!preferences.persistent && preferences.devices.length === 0 && <p>No recipients selected: new alerts will remain in PlantCare only.</p>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save notification recipients"}</button>
      <button type="button" className="secondary-button" disabled={busy || !enabled || preferences.devices.length === 0} onClick={() => void test()}>Send test to selected devices</button>
    </>}
    <button type="button" className="secondary-button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh devices</button>
    {message && <p role="status">{message}</p>}
  </>;
}
