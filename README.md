# Shawarma Studio

The public half of Shawarma REPL:

- `app/` is the browser editor for [Strudel](https://strudel.cc) songs: code editor, section map, run-selection,
  version history, offline render and WAV/MP3 export. Song code runs in a sandboxed runtime iframe.
- `check-service/` is a small HTTP service that evaluates song code in a sandboxed child process and reports
  errors and structure.
- `shared/` holds types and helpers used by both.

`app/` and `check-service/` are AGPL-3.0-or-later (see `LICENSE`) because they bundle Strudel. `shared/` is MIT
(see `shared/LICENSE`) and never imports Strudel.

The hosted platform that adds the AI assistant, accounts and billing is a separate program. The editor talks to it
over HTTP only; nothing here imports it.

## Sounds

The built-in sample packs are listed with their licences in `shared/src/soundPacks.ts`. Locally they are played
from Strudel's sample CDN (`strudel.b-cdn.net`) and the GM instruments from `felixroos.github.io`, and the editor
loads all of them, as strudel.cc does. A host can serve the packs itself: `/api/me` then names their URL
(`packsUrl`), which the song runtime gets in its URL (`s=`) and loads every sample map, sample and soundfont from. Hosted
Shawarma offers only the cleanly licensed ones (Salamander piano CC BY 3.0, VCSL CC0, uzu-drumkit Unlicense,
mridangam CC BY-SA 4.0, plus the GM instruments) and credits them on `/source`: the app learns the mode from
`/api/me` and passes it to the song runtime in its URL; the check service reads `SOUND_PACKS=hosted|all` (default
`all`) and then treats the other packs' sounds as unknown and leaves the reference entries that use them out.

## Run

Needs Node >= 22.15 and pnpm.

```sh
pnpm install
pnpm test        # shared, check-service and the app's unit tests
pnpm typecheck
pnpm build       # app -> app/dist
pnpm --filter @shawarma/check-service start   # check service
pnpm --filter @shawarma/app dev               # editor (expects the platform API for AI, accounts, storage)
```

The app's end-to-end tests (`app/e2e`, `app/e2e-hosted`) need the platform server and its database, so they only run
from the parent repository root (`pnpm --filter @shawarma/app e2e`, `pnpm e2e:hosted`).
