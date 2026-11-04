# Surface Brief: Kissa Vox Studio (`src/app/page.tsx`) & Listener Keepsake (`src/app/listen/[id]/page.tsx`)

## Scope and Visitor Mode

- **Primary target**: `src/app/page.tsx` — Visitor mode: `operate` (Creator Studio for recording spoken voice, generating AI backing audio, auto-ducking mixing, and pressing a QR keepsake card).
- **Related target**: `src/app/listen/[id]/page.tsx` — Visitor mode: `experience` (Mobile QR scan destination where the recipient unseals and listens to the 7-inch vinyl voice keepsake).

## Audience, Job, and Constraints

- **Audience**: Senders creating a personal spoken voice keepsake for a physical gift card or postcard, and recipients scanning the QR code on their phone.
- **Task**: Record or upload spoken voice -> generate vocal-free instrumental BGM or seamless ambient loops via Gemini Mood Match, ElevenLabs (`/v1/music` & `/v1/sound-generation`), Fal.ai (`fal-ai/stable-audio`, `cassetteai/music-generator`, `fal-ai/ace-step`), or built-in offline acoustic beds -> adjust real-time Web Audio API auto-ducking mixer -> enter recipient/sender metadata and export the 7-inch vinyl sleeve QR card and `/listen/[id]` URL.

## Direction contract

THESIS: A Tokyo late-night Jazz Kissa request slip and 7-inch single pressing desk that turns a raw spoken voice recording and AI backing track into a tangible vinyl sleeve keepsake with an obi-strip QR code, refusing both cold multi-track DAW timelines and generic white SaaS cards.

OWN-WORLD: Unbleached kraft-paper ground (`#F4EFE6`) and cream slip stock (`#FAF6F0`) framed by deep roasted-espresso ink borders (`#1E1916`), hanko-vermilion recording/obi accents (`#C84B31`), forest-moss ready stamps (`#2D5A43`), and warm brass metadata (`#D9A05B`), paired with `Shippori Mincho` display headings, `Noto Sans TC` UI copy, and `JetBrains Mono` tabular timecodes and dB readouts.

STORY: The sender steps through four numbered request-slip stages on the left while watching their 7-inch vinyl jacket and vertical obi-strip QR code assemble live on the right; when scanned, the recipient's phone opens that exact vinyl sleeve to drop the needle and listen.

FIRST VIEWPORT: A 68px deep-espresso header bar (`#1E1916`) with a bottom vermilion rule (`#C84B31`) housing the title "喫茶 聲・KISSA VOX" on the left and the API Engine Switcher (`ELEVENLABS` / `FAL.AI` / `OFFLINE SAMPLE` + API Key drawer trigger) on the right; below, a two-column split with the 4-stage numbered request slips (`01` Voice Recording, `02` AI Mood & Backing with focused dark-espresso plate `#1E1916` and 6 mood tags, `03` Auto-Ducking Mixer with 3 faders, `04` Pressing & Sleeve Metadata) on the left and the 500px stage on the right showcasing the 7-inch vinyl jacket with a vertical vermilion obi-strip (`#C84B31`) holding the live scannable QR code and export buttons.

FORM: Candidate 1 of grounded list (Japanese Jazz Kissa Request Slip & Album Sleeve Index — picked via IMPECCABLE'S PICK), seed:59d1edea571371ec.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
