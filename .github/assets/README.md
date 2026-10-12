# README artwork

The root README uses transparent, outlined SVG typography. Light and dark variants are selected with GitHub-supported `picture` elements.

- `wods-readme-wordmark*.svg`: a custom angular, forward-slanted WODS wordmark without a separate symbol. The letters have a light-blue, white and purple gradient, with smooth vector binary digits clipped inside their outlines. The texture has consistent spacing and reduced opacity to keep the letterforms clear. The light variant adds a fine outline to keep the pale lettering visible on white. Asset names include a content hash to refresh GitHub's image cache when the artwork changes.
- `wods-title*.svg`, `wods-free*.svg` and `wods-planned*.svg`: custom vector headings using the same angular letterforms, forward slant and light-blue/white/purple gradient as the WODS wordmark. The smaller headings omit the binary texture for readability. Each has a light and dark variant and a content-hashed filename.
- `wods-product.png`: an unmodified crop of the live WODS URL-entry interface, captured in English on 8 October 2026. It is a product screenshot, not a mockup. No transcription was submitted.

All current lettering and binary digits use custom vector paths. No font download or embedded raster image is required to render the typography. The Barlow license retained in this directory covers earlier artwork in the repository history.
