import { useEffect, useState } from 'react';
import { SINK_UNSUPPORTED, chooseOutput, listOutputs, revealDeviceNames, savedOutput, sinkSupported, type OutputDevice } from './audioOutput';

type Status = { kind: 'ok' | 'err'; text: string } | null;

/** Audio output device for the song (the runtime's AudioContext). */
export function AudioSettings() {
  const supported = sinkSupported();
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [named, setNamed] = useState(true);
  const [current, setCurrent] = useState(() => savedOutput()?.deviceId ?? '');
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => listOutputs().then((r) => { setDevices(r.devices); setNamed(r.named); }).catch((e) => setStatus({ kind: 'err', text: `Could not list audio devices: ${(e as Error).message}` }));
  useEffect(() => {
    if (!supported) return;
    void refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', refresh);
    return () => md?.removeEventListener?.('devicechange', refresh);
  }, []);

  const choose = async (id: string) => {
    const device = devices.find((d) => d.deviceId === id) ?? null;
    setBusy(true);
    try {
      await chooseOutput(id ? device : null);
      setCurrent(id);
      setStatus({ kind: 'ok', text: id && device ? `The song now plays on ${device.label}.` : 'The song plays on the system default output.' });
    } catch (e) {
      setStatus({ kind: 'err', text: (e as Error).message });
    } finally { setBusy(false); }
  };
  const reveal = async () => {
    try { await revealDeviceNames(); await refresh(); }
    catch { setStatus({ kind: 'err', text: 'Microphone access was not allowed, so the browser keeps the device names hidden. Allow it in the address bar\'s site settings and try again.' }); }
  };

  if (!supported) {
    return <p className="settings-warning" role="note">{SINK_UNSUPPORTED}</p>;
  }
  const choices = devices.filter((d) => d.deviceId !== 'default');
  return (
    <div className="settings-grid">
      <div className="settings-field">
        <label htmlFor="audio-output" className="settings-label">Output device</label>
        <select id="audio-output" value={choices.some((d) => d.deviceId === current) ? current : ''} disabled={busy} onChange={(e) => void choose(e.target.value)}>
          <option value="">System default</option>
          {choices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
        <p className="muted settings-hint">Applies to playback in this browser. Exports are rendered offline and are not affected.</p>
      </div>
      {!named && (
        <div className="settings-field">
          <p className="muted settings-hint">The browser hides device names until this page has used a microphone once. Allowing it lists them; nothing is recorded.</p>
          <button type="button" className="btn" onClick={() => void reveal()}>Show device names</button>
        </div>
      )}
      {status && <div role="status" className={status.kind === 'err' ? 'err-text' : 'ok-text'}>{status.text}</div>}
    </div>
  );
}
