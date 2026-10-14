/*
controls.mjs - Registers audio controls for pattern manipulation and effects.
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/core/controls.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// Excerpt from Strudel (https://codeberg.org/uzu/strudel), commit 0a6d61e14a37ad6f3c687c4b0397c8fbf57f37ca, AGPL-3.0-or-later.

/**
 * Select a sound / sample by name. When using mininotation, you can also optionally supply 'n' and 'gain' parameters
 * separated by ':'.
 *
 * @name s
 * @tags superdough, samples
 * @param {string | Pattern} sound The sound / pattern of sounds to pick
 * @synonyms sound
 * @example
 * s("bd hh")
 * @example
 * s("bd:0 bd:1 bd:0:0.3 bd:1:1.4")
 *
 */
export const { s, sound } = registerControl(['s', 'n', 'gain'], 'sound');

/**
 * Sets the level of the delay signal.
 *
 * When using mininotation, you can also optionally add the 'delaytime' and 'delayfeedback' parameter,
 * separated by ':'.
 *
 *
 * @name delay
 * @tags orbit, superdough, supradough
 * @param {number | Pattern} level between 0 and 1
 * @example
 * s("bd bd").delay("<0 .25 .5 1>")
 * @example
 * s("bd bd").delay("0.65:0.25:0.9 0.65:0.125:0.7")
 *
 */
export const { delay } = registerControl(['delay', 'delaytime', 'delayfeedback']);
/**
 * Sets the level of the signal that is fed back into the delay.
 * Caution: Values >= 1 will result in a signal that gets louder and louder! Don't do it
 *
 * @name delayfeedback
 * @tags orbit, superdough, supradough
 * @param {number | Pattern} feedback between 0 and 1
 * @synonyms delayfb, dfb
 * @example
 * s("bd").delay(.25).delayfeedback("<.25 .5 .75 1>")
 *
 */
export const { delayfeedback, delayfb, dfb } = registerControl('delayfeedback', 'delayfb', 'dfb');

/**
 * Sets the time of the delay effect.
 *
 * @name delayspeed
 * @tags supradough
 * @param {number | Pattern} delayspeed controls the pitch of the delay feedback
 * @synonyms delayt, dt
 * @example
 * note("d d a# a".fast(2)).s("sawtooth").delay(.8).delaytime(1/2).delayspeed("<2 .5 -1 -2>")
 *
 */
export const { delayspeed } = registerControl('delayspeed');

/**
 * Sets the time of the delay effect in seconds.
 *
 * @name delaytime
 * @tags orbit, superdough, supradough
 * @param {number | Pattern} delay in seconds
 * @synonyms delayt, dt
 * @example
 * note("d d a# a".fast(2))
 * .s("sawtooth")
 * .delay(.8)
 * .delaytime(1/2)
 * .delayspeed("<2 .5 -1 -2>")
 */
export const { delaytime, delayt, dt } = registerControl('delaytime', 'delayt', 'dt');
