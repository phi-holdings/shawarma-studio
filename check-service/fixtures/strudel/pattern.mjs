/*
pattern.mjs - Core pattern representation for strudel
Copyright (C) 2025 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/core/pattern.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// Excerpt from Strudel (https://codeberg.org/uzu/strudel), commit 0a6d61e14a37ad6f3c687c4b0397c8fbf57f37ca, AGPL-3.0-or-later.

/**
 * Speed up a pattern by the given factor. Used by "*" in mini notation.
 *
 * @tags temporal
 * @name fast
 * @synonyms density
 * @memberof Pattern
 * @param {number | Pattern} factor speed up factor
 * @returns Pattern
 * @example
 * s("bd hh sd hh").fast(2) // s("[bd hh sd hh]*2")
 */
export const { fast, density } = register(
  ['fast', 'density'],
  function (factor, pat) {
    if (factor === 0) {
      return silence;
    }
    factor = Fraction(factor);
    const fastQuery = pat.withQueryTime((t) => t.mul(factor));
    return fastQuery.withHapTime((t) => t.div(factor)).setSteps(pat._steps);
  },
  true,
  true,
);

/**
 * Both speeds up the pattern (like 'fast') and the sample playback (like 'speed').
 * @tags temporal
 * @example
 * s("bd sd:2").hurry("<1 2 4 3>").slow(1.5)
 */
export const hurry = register('hurry', function (r, pat) {
  return pat._fast(r).mul(pure({ speed: r }));
});
