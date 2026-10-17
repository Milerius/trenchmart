# Design sources

| File | Screen | Route |
|------|--------|-------|
| Main.dc.html | Home & browse | / |
| Listing.dc.html | Listing + security report | /l/[slug] |
| Upload.dc.html | Creator upload & verification | /studio/... |
| Economics.dc.html | Fees & $TRENCH perks | /token |
| tokens.json | Design tokens | - |

These are Claude Design canvas sources. Markup is plain HTML with inline styles.
`{{name}}` holes are filled by `renderVals()` in the script at the bottom of each file,
`<sc-for list=... as=...>` is a loop, `<sc-if value=...>` a conditional.
They need the canvas runtime (`support.js`) to render, so use them as pixel/copy
reference and rebuild as React + Tailwind (see docs/08 and docs/09).
Sample data inside them (listings, creators, ratings) is placeholder.
