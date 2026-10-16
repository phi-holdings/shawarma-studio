import { evalScope } from '@strudel/core';
import { aliasBank, registerSynthSounds, registerZZFXSounds, samples } from '@strudel/webaudio';
import { DRUM_MACHINE_ALIASES, soundPacksFor, soundSources, type SoundPackSet } from '@shawarma/shared';

export function loadModules() {
  return evalScope(
    import('@strudel/core'),
    import('@strudel/mini'),
    import('@strudel/tonal'),
    import('@strudel/webaudio'),
    import('@strudel/codemirror'),
    import('@strudel/soundfonts'),
  );
}

/**
 * Built-in sounds: synths, the GM soundfonts and the sample packs of the set (hosted: only cleanly licensed
 * ones), from `packsUrl` when the packs are self-hosted (hosted mode), else from Strudel's CDNs.
 */
export async function prebake(packs: SoundPackSet = 'all', packsUrl: string | null = null) {
  const src = soundSources(packsUrl);
  await Promise.all([
    registerSynthSounds(),
    registerZZFXSounds(),
    import('@strudel/soundfonts').then(({ registerSoundfonts, setSoundfontUrl }) => { setSoundfontUrl(src.soundfonts); registerSoundfonts(); }),
    ...soundPacksFor(packs).map((p) => samples(`${src.samples}/${p.map}`, `${src.samples}/${p.folder}/`, { prebake: true, ...(p.tag ? { tag: p.tag } : {}) })),
  ]);
  if (packs === 'all') aliasBank(`${src.samples}/${DRUM_MACHINE_ALIASES}`);
}

/** Options for the live-playback initAudio call (Editor first click and post-render restore must match). */
export const LIVE_AUDIO_OPTIONS: Record<string, unknown> | undefined = undefined;
