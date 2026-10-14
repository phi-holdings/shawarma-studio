import { evalScope } from '@strudel/core';
import { aliasBank, registerSynthSounds, registerZZFXSounds, samples } from '@strudel/webaudio';

const CDN = 'https://strudel.b-cdn.net';

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

export async function prebake() {
  await Promise.all([
    registerSynthSounds(),
    registerZZFXSounds(),
    import('@strudel/soundfonts').then(({ registerSoundfonts }) => registerSoundfonts()),
    samples(`${CDN}/piano.json`, `${CDN}/piano/`, { prebake: true }),
    samples(`${CDN}/vcsl.json`, `${CDN}/VCSL/`, { prebake: true }),
    samples(`${CDN}/tidal-drum-machines.json`, `${CDN}/tidal-drum-machines/machines/`, { prebake: true, tag: 'drum-machines' }),
    samples(`${CDN}/uzu-drumkit.json`, `${CDN}/uzu-drumkit/`, { prebake: true, tag: 'drum-machines' }),
    samples(`${CDN}/uzu-wavetables.json`, `${CDN}/uzu-wavetables/`, { prebake: true }),
    samples(`${CDN}/mridangam.json`, `${CDN}/mrid/`, { prebake: true, tag: 'drum-machines' }),
  ]);
  aliasBank(`${CDN}/tidal-drum-machines-alias.json`);
}

/** Options for the live-playback initAudio call (Editor first click and post-render restore must match). */
export const LIVE_AUDIO_OPTIONS: Record<string, unknown> | undefined = undefined;
