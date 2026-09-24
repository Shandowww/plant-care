import { useEffect, useState } from "react";
import { getNotificationDevices, getNotificationPreferences, saveNotificationPreferences } from "./api";
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
  return <>
    <p>Select phones or tablets registered with the Home Assistant Companion app. Tap an alert to open the affected plant.</p>
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
    </>}
    <button type="button" className="secondary-button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh devices</button>
    {message && <p role="status">{message}</p>}
  </>;
}
