# Clint email signature + Stout intro email

Brand assets and ready-to-send copy for the `support@clintapp.com` Gmail account.
Built in the Clint brand: triple-nested-C mark (slate-300 -> slate-400 -> teal-600
`#0d9488`), "Clint" in slate-900, a thin teal accent rule, web-safe Arial stack.

## Files

| File | What it is |
| --- | --- |
| `clint-email-signature.html` | Open in a browser, copy, paste into Gmail signature settings. |
| `stout-intro-email.html` | Open in a browser, copy, paste into a Gmail compose window. |
| `../../src/client/public/email/clint-mark.png` | The logo (240x240, transparent). Deploys to `https://clintapp.com/email/clint-mark.png`. |

## Before you start: deploy the logo

The signature references the logo at `https://clintapp.com/email/clint-mark.png`.
That URL only works after the PNG is deployed. Push `develop` (dev) or merge to
`main` (prod) first, then confirm the image loads in a browser before installing.

Alternative with no deploy needed: in the Gmail signature editor, delete the
pasted logo and re-add it via **Insert image > Upload** using the local
`clint-mark.png`. Gmail then re-hosts it on Google's CDN, so it never depends on
clintapp.com being up.

## Install the signature in Gmail

1. Open `clint-email-signature.html` in Chrome.
2. Select the content inside the white frame (or Cmd+A), then Cmd+C.
3. Gmail > Settings (gear) > **See all settings** > **General** > **Signature**.
4. **Create new**, name it "Clint", paste into the box.
5. Set it as the default for **new emails** and **replies/forwards**.
6. **Save changes**, then send yourself a test to confirm the logo renders.

## The Stout intro email

**Subject:** `Clint -- ahead of our Wednesday call`

Open `stout-intro-email.html`, copy the framed block into a new message, and
attach the deck (`stout-intro.html`) if you want it as a file as well as the
in-body link. Swap `[John]` / `Sam` if the names change.

### Plain-text fallback

If you would rather type it in plain text (signature still auto-appends):

```
Hi John,

Thanks, Sam, for setting up this call, and thank you, John, for carving out the
time for this presentation.

I'm really excited to present Clint, the solution I've been building based on the
pain points I've heard from Sam and a gap I saw in the market for CI engagement
tooling.

I've attached the deck I'll be walking through on our call so you can scan it
ahead of time, at your convenience, and get familiar with the product. On
Wednesday I'll do a deep dive and show the actual platform live.

Deck: https://clintapp.com/internal/stout-intro.html

Again, thank you for the time, and I hope you have a wonderful weekend.

Best,
Aaditya
```

## Regenerating the logo PNG

The mark uses the geometry and colors from `clint-mark.ts` (the in-app source of
truth), with stroke widths from `clintMarkStrokes(44)` -- the `size <= 48` tier
(`2.5 / 3.5 / 5`), matching how the app renders the mark at the signature's 44px
display size (deliberately *not* the favicon, which uses the heavier 32px tier).
To regenerate (from `src/client/`, `sharp` is already a dependency):

```js
// gen-mark.mjs -- run with: node gen-mark.mjs
import sharp from 'sharp';
const svg = `<svg width="240" height="240" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg">
  <polyline points="112,24 24,24 24,116 112,116" stroke="#cbd5e1" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="96,40 40,40 40,100 96,100" stroke="#94a3b8" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="80,56 56,56 56,84 80,84" stroke="#0d9488" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
await sharp(Buffer.from(svg)).resize(240, 240).png({ compressionLevel: 9 }).toFile('public/email/clint-mark.png');
```
