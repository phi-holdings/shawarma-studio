# Strudel reference

`strudel-reference.json` is the function reference (one entry per function: name, synonyms,
description, parameters, examples) and the documentation (`learn/*.mdx` and `functions/*.mdx`, one
entry per `#`/`##` section) of [Strudel](https://strudel.cc), built from the Strudel source at the
commit recorded in the file (`generatedFrom.commit`). The check service serves it at
`GET /reference?q=...&limit=5&kinds=function,doc` (BM25 keyword search).

**Licence and attribution.** The text is from Strudel, copyright the Strudel authors, licensed
AGPL-3.0-or-later (https://codeberg.org/uzu/strudel). This package is AGPL-3.0-or-later too. Every
entry links to its source file at the pinned commit. Strudel's example tunes (mostly CC BY-NC-SA,
non-commercial) are deliberately not included.

Rebuild from a Strudel checkout:

    pnpm --filter @shawarma/check-service build-reference --strudel /path/to/strudel
