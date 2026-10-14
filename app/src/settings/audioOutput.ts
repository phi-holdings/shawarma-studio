// Audio output device: listed here (the app page), applied in the song runtime with
// AudioContext.setSinkId (protocol `setOutput`), and remembered in localStorage.
import { getRuntime } from '../runtime/client';

export interface OutputDevice { deviceId: string; label: string }

const KEY = 'shawarma.audioOutput';

export const SINK_UNSUPPORTED =
  'This browser cannot send web audio to a chosen device (it needs AudioContext.setSinkId, in Chrome and Edge 110 or later). Pick the output in your system sound settings instead.';

export const sinkSupported = () => typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

export function savedOutput(): OutputDevice | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.deviceId === 'string' && typeof v.label === 'string' ? { deviceId: v.deviceId, label: v.label } : null;
  } catch { return null; }
}

/** Output devices; `named` is false while the browser hides names (until a media permission is granted). */
export async function listOutputs(): Promise<{ devices: OutputDevice[]; named: boolean }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { devices: [], named: false };
  const all = await navigator.mediaDevices.enumerateDevices();
  const outs = all.filter((d) => d.kind === 'audiooutput' && d.deviceId);
  const named = outs.some((d) => d.label);
  return { devices: outs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Output ${i + 1}` })), named };
}

/** Browsers name devices only after a media permission: ask for the microphone once, then let it go at once. */
export async function revealDeviceNames(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

/** Switches the song runtime's output ('' = system default) and remembers the choice. */
export async function chooseOutput(device: OutputDevice | null): Promise<void> {
  if (!sinkSupported()) throw new Error(SINK_UNSUPPORTED);
  const d = device ?? { deviceId: '', label: '' };
  await getRuntime().request({ type: 'setOutput', deviceId: d.deviceId, ...(d.label ? { label: d.label } : {}) });
  if (device && device.deviceId && device.deviceId !== 'default') localStorage.setItem(KEY, JSON.stringify(device));
  else localStorage.removeItem(KEY);
}

/** On start (and after the runtime reloads): the remembered device, if any. Failures are reported to `onError`. */
export function restoreOutput(onError: (message: string) => void): () => void {
  const apply = () => {
    const d = savedOutput();
    if (!d || !sinkSupported()) return;
    getRuntime().request({ type: 'setOutput', deviceId: d.deviceId, label: d.label })
      .catch((e) => onError((e as Error).message));
  };
  apply();
  return getRuntime().on('reloaded', apply);
}
