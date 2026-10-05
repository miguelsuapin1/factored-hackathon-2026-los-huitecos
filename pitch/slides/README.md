# Pitch slides (sources)

These are HTML sources for the three images in `pitch/`, each at 2000 × 1125 to match the deck. They use the app's own design: the palette, the GT Bank mark and the volcano-contour backdrop come from `src/app/globals.css`, `src/components/brand.tsx` and `src/components/QuetzalBackdrop.tsx`.

| File | Image | What it shows |
|---|---|---|
| `turn.html` | `../architecture-turn.png` | One conversation turn (`POST /api/chat`): mask → intent + details → dialogue → policy → verify → phrase → response |
| `data.html` | `../architecture-data.png` | Organizer CSVs → Cloud Storage → BigQuery bronze → dbt silver/gold → Supabase → app |
| `case.html` | `../handoff-case.png` | The real case row written by test conversation TC-04 (GT-5EETTXDQ, production evaluation run, 2026-10-04) next to what the customer saw |

## Edit and re-render

```bash
cd pitch/slides
npm install                        # fonts (Geist, Instrument Serif) and playwright-core
node render.mjs turn data case     # writes ../architecture-turn.png, ../architecture-data.png, ../handoff-case.png
```

- **Browser:** rendering uses your installed Google Chrome. Set `CHROME_PATH` to use another Chromium.
- **Overflow check:** the script prints any card whose text no longer fits, so check its output after editing the wording.
- **Fonts:** opened directly in a browser, the slides load their fonts from Google Fonts. The renderer works offline from `node_modules`.

Every claim on the slides was checked against the code and reports on 2026-10-05; see `../video-script.md`, "Fact-check".
