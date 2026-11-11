# Third-party notices and provenance

The project's original code is under MIT; see LICENSE. Third-party assets retain their own licenses. The MIT license does not replace these notices or grant rights to Ratspeak trademarks.

## Included browser dependencies

- **Rat emoji icon**, Google Noto Emoji, Apache-2.0. `public/favicon.svg`, used for both the favicon and app icon. Original SVG from the `v2020-09-16-unicode13_1` release, distributed unchanged; full license in `public/vendor/noto-emoji-LICENSE.txt`. Source: https://github.com/googlefonts/noto-emoji/blob/v2020-09-16-unicode13_1/svg/emoji_u1f400.svg

- **QR Code Generator for JavaScript 1.4.4**, Kazuhiko Arase, MIT. `public/vendor/qrcode.js`; full notice in `public/vendor/qrcode-LICENSE.txt`. https://github.com/kazuhikoarase/qrcode-generator
- **jsQR 1.4.0**, copyright 2017 Cosmo Wolfe, Apache-2.0. `public/vendor/jsQR.js` and the test copy `tests/jsQR.cjs`; license in `public/vendor/jsQR-LICENSE.txt` and `tests/jsQR-LICENSE.txt`. https://github.com/cozmo/jsQR
- **Outfit**, copyright 2021 The Outfit Project Authors, SIL Open Font License 1.1. `public/fonts/outfit-latin.woff2`, notice in `public/fonts/outfit-LICENSE.txt`. https://github.com/Outfitio/Outfit-Fonts
- **JetBrains Mono**, copyright 2020 The JetBrains Mono Project Authors, SIL Open Font License 1.1. `public/fonts/jetbrains-mono-latin.woff2`, notice in `public/fonts/jetbrains-mono-LICENSE.txt`. https://github.com/JetBrains/JetBrainsMono

The Latin WOFF2 font files were obtained from Ratspeak's public dashboard assets. The font license notices are retained separately from the application's license. The offline build embeds all the above license texts.

## Interoperability and inspiration

Ratspeak's public contact-card sources were consulted to understand `lxma://`, RSCP1 and RSCP2 field layouts, hash binding, and rounded QR behavior. This project's parsers, QR preprocessing and UI are separate implementations; Ratspeak application modules, logo and stylesheets are not distributed. The palette and typeface choices follow Ratspeak's app for familiarity. This is an independent tool, not an official Ratspeak release.

Ratspeak currently uses the **Reticulum License**, including restrictions on purposeful harm and AI/ML training datasets. This project does not relicense upstream files under MIT. Upstream: https://github.com/Ratspeak/Ratspeak; license checked 2026-11-11: https://raw.githubusercontent.com/Ratspeak/Ratspeak/main/LICENSE

### Benn Jordan — inspiration and block-codec reference

Benn Jordan's work inspired Packrat's image transport experiment. The app's visible footer credits him and links to his steganography projects:

- https://www.bennjordan.com/blog/stego-links
- https://bennjordan.github.io/HideUrBits/
- https://github.com/bennjordan/zip-image-stego

The legacy block codec in `public/codec.js` was informed by Benn Jordan’s `RobustBlockFileSteg` in `zip-image-stego`: 8×8 blocks, center-versus-edge luminance, repeated bits and Hamming(7,4) correction. These algorithmic ideas are credited here and in the source header. Packrat implements them in separately written JavaScript, with its own packet format, block ordering and browser-native authenticated encryption. No upstream Python or HideUrBits source is distributed. LSB and DCT codecs implement the algorithms described in PROTOCOL.md.

## Development dependencies

esbuild (MIT) and playwright-core (Apache-2.0) are development tools, installed from the locked npm dependency tree. Their package notices accompany those packages. They are not loaded by visitors. The esbuild-generated offline bundle contains this project's code and the browser libraries listed above.

## Paper-link interoperability references and test vector

The separately written `public/paper-message.js` implements only the outer `lxm://` transport syntax, normalization and size checks, informed by Ratspeak v1.0.44 `crates/ratspeak-runtime/src/paper.rs` and rsLXMF’s `message.rs`/`constants.rs`. Upstream application/decryption modules are not included.

`tests/paper-fixture.mjs` is an independently generated public test envelope containing original test text. It was created using the reference Python packages RNS 1.5.5 and LXMF 1.2.0 with fresh, temporary in-memory identities, then decrypted and signature-verified before retaining only the encrypted URI and destination. No private keys, SDK code or upstream test-vector data are included. The reference packages are not project dependencies and are not needed to run the tests.

Format references:

- https://github.com/Ratspeak/Ratspeak/blob/v1.0.44/crates/ratspeak-runtime/src/paper.rs
- https://github.com/Ratspeak/rsLXMF/blob/main/crates/lxmf-core/src/message.rs
- https://github.com/Ratspeak/rsLXMF/blob/main/crates/lxmf-core/src/constants.rs
- https://pypi.org/project/lxmf/1.2.0/
