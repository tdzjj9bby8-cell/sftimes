# Self-hosted fonts

Drop the four variable font families here before the first build:

- `Fraunces-Variable.woff2` and `Fraunces-Variable-Italic.woff2`
- `Newsreader-Variable.woff2` and `Newsreader-Variable-Italic.woff2`
- `Inter-Variable.woff2`
- `JetBrainsMono-Variable.woff2`

Sources (all Google Fonts, all OFL or SIL Open Font License, commercial-use OK):

- Fraunces: https://fonts.google.com/specimen/Fraunces
- Newsreader: https://fonts.google.com/specimen/Newsreader
- Inter: https://fonts.google.com/specimen/Inter
- JetBrains Mono: https://fonts.google.com/specimen/JetBrains+Mono

Download as TTF, convert to woff2 with `fonttools` or https://transfonter.org/.
Filenames in this folder must match the names above for `src/styles/global.css`
to pick them up.

The build will still run without these files (Astro doesn't error on missing
public assets) but the rendered site will fall back to system fonts.
