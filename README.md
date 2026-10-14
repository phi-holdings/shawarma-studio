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
