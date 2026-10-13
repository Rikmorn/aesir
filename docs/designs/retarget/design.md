# Retarget
Status: exploring · Scale: explore · 2026-09-30

What aesir becomes: an exploration begun on 2026-09-16, written as topic notes rather than in this note's sections. `README.md` is the index, and the place to start. It lists the topics and their status, the research inputs, the positions so far, and the two decisions so far.

No issue yet. A `change-request` issue on `Rikmorn/aesir` is filed once topic 1 settles what the request is (`README.md`). #97 brought this folder into the repo and changed only paths that no longer resolved.

## What is here

- `README.md` and the topic notes `00` to `07`, each in the evaluation shape that `README.md` §Method describes.
- The grounding reports live in `docs/research/retarget/`, whose `README.md` indexes them, and the notes cite them by that path. They are records and outlive this folder: new research for the design lands there too, and none moves back here.
- `spec/` is the source of the spec site: nine pages that present the proposal, linking back to the notes and the research. Each page body is hand-written HTML, and `spec/site.json` holds the page list, the titles and the footer.

Build the site into the gitignored `site/`, then open `site/index.html`:

```bash
python3 scripts/docs-builder/build.py --source docs/designs/retarget/spec --target docs/designs/retarget/site
```

The copy published to claude.ai carries the notes under `notes/` and the reports under `notes/research/`. Build it with `--target docs/designs/retarget/dist --profile dist`, which rewrites the note and report links to match; `dist/` is gitignored too.

## Next

The next retarget session fills this note's `sk-design` sections from the topic notes, with the lens table and an adversarial review. #97 left both out of scope.
