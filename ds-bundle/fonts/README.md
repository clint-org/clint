# Fonts

Clint ships **no web fonts** — this directory carries no font files on purpose.

The product uses platform **system stacks** deliberately:

- **Sans** (`--font-sans`) — body and UI text.
- **Mono** (`--font-mono`) — the data-instrument surfaces: timeline headers, axes,
  chips, tabular figures, and the small uppercase structural labels.

System fonts render instantly, carry the terminal/medical-journal feel Clint is
after, and avoid any branded-consumer-app look. Reference the `--font-sans` /
`--font-mono` variables (defined in `fonts.css`, imported by `styles.css`) rather
than hard-coding stacks.
