import { useEffect, useRef, useState } from 'react';
import { DB_FLOOR, db } from '../audio/analysis';
import { getRuntime } from '../runtime/client';

const CLIP_HOLD_MS = 2000;
const METER_FLOOR_DB = -60;

/** Live output level (spec §4): peak dBFS of the master bus with a held clip indicator. */
export function LevelMeter() {
  const [level, setLevel] = useState({ peak: 0, rms: 0 });
  const [clipAt, setClipAt] = useState(0);
  const [now, setNow] = useState(0);
  const lastClip = useRef(0);

  useEffect(() => {
    const rt = getRuntime();
    void rt.request({ type: 'levels', enabled: true });
    const off = rt.on('levels', (m) => {
      const peak = Math.max(0, ...m.peak);
      const rms = Math.max(0, ...m.rms);
      setLevel({ peak, rms });
      if (peak >= 1) { lastClip.current = Date.now(); setClipAt(lastClip.current); }
      setNow(Date.now());
    });
    const offStop = rt.on('stopped', () => setNow(Date.now()));
    // a reloaded runtime is silent and needs metering switched on again
    const offReload = rt.on('reloaded', () => { setLevel({ peak: 0, rms: 0 }); void rt.request({ type: 'levels', enabled: true }).catch(() => {}); });
    return () => { off(); offStop(); offReload(); void rt.request({ type: 'levels', enabled: false }); };
  }, []);

  const peakDb = Math.max(db(level.peak), DB_FLOOR);
  const pct = Math.max(0, Math.min(1, (peakDb - METER_FLOOR_DB) / -METER_FLOOR_DB)) * 100;
  const clipping = clipAt > 0 && now - clipAt < CLIP_HOLD_MS;
  return (
    <span className="meter" data-testid="level-meter" data-peak={level.peak.toFixed(6)} data-rms={level.rms.toFixed(6)} title="Output peak (dBFS)">
      <span className="meter-bar"><span className="meter-fill" style={{ width: `${pct}%` }} /></span>
      <span className="meter-db">{level.peak > 0 ? `${peakDb.toFixed(1)} dB` : '-inf dB'}</span>
      <span className={`meter-clip${clipping ? ' on' : ''}`} aria-label={clipping ? 'clipping' : 'no clipping'}>CLIP</span>
    </span>
  );
}
