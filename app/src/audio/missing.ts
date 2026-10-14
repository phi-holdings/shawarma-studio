/** Plays every hap, collecting (instead of throwing on) sounds that fail, e.g. unknown sample names. */
export async function playHaps(
  haps: any[],
  play: (value: any, t: number, dur: number, cps: number, hap: any) => Promise<unknown>,
  begin: number,
  cps: number,
  gainScale = 1,
): Promise<string[]> {
  const missing = new Set<string>();
  for (const hap of haps) {
    hap.ensureObjectValue();
    const value = { ...hap.value, velocity: (hap.value.velocity ?? 1) * gainScale };
    const t = (hap.whole.begin.valueOf() - begin) / cps;
    try {
      await play(value, t, hap.duration / cps, cps, hap);
    } catch (e) {
      missing.add(String(hap.value.s ?? hap.value.note ?? (e as Error)?.message ?? 'unknown'));
    }
  }
  return [...missing];
}

export function missingSoundsMessage(missing: string[]): string {
  return `Missing sounds: ${missing.join(', ')}`;
}
