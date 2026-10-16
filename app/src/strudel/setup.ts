import { evalScope } from '@strudel/core';
import { aliasBank, registerSynthSounds, registerZZFXSounds, samples } from '@strudel/webaudio';
import { DRUM_MACHINE_ALIASES, SAMPLE_CDN as CDN, soundPacksFor, type SoundPackSet } from '@shawarma/shared';

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

/** Built-in sounds: synths, the GM soundfonts and the sample packs of the set (hosted: only cleanly licensed ones). */
export async function prebake(packs: SoundPackSet = 'all') {
  await Promise.all([
    registerSynthSounds(),
    registerZZFXSounds(),
    import('@strudel/soundfonts').then(({ registerSoundfonts }) => registerSoundfonts()),
    ...soundPacksFor(packs).map((p) => samples(`${CDN}/${p.map}`, `${CDN}/${p.folder}/`, { prebake: true, ...(p.tag ? { tag: p.tag } : {}) })),
  ]);
  if (packs === 'all') aliasBank(`${CDN}/${DRUM_MACHINE_ALIASES}`);
}

/** Options for the live-playback initAudio call (Editor first click and post-render restore must match). */
export const LIVE_AUDIO_OPTIONS: Record<string, unknown> | undefined = undefined;
