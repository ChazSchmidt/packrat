# Packrat packet and image formats

## Packet framing

All image profiles carry the same header/body/CRC frame. No EXIF, custom PNG chunks or appended bytes are used.

| Offset     |    Bytes | Contents                                  |
| ---------- | -------: | ----------------------------------------- |
| 0          |        4 | ASCII RSST                                |
| 4          |        1 | Packet payload type/version: 1–5          |
| 5          |        1 | 0 open; 1 PBKDF2/AES-GCM protected        |
| 6          |        2 | Body byte count, unsigned big endian      |
| 8          | variable | Body                                      |
| after body |        4 | Big-endian IEEE CRC32 of header plus body |

| Version | Body without Packrat password                                          | Protected body size | Meaning                                                       |
| ------- | ---------------------------------------------------------------------- | ------------------: | ------------------------------------------------------------- |
| 1       | 16-byte LXMF destination + 64-byte public key                          |           124 bytes | Earlier compact full card                                     |
| 2       | 16-byte LXMF destination                                               |            60 bytes | Address only; older identity-entry images also used this form |
| 3       | Exact native RSCP1 or RSCP2 UTF-8 text, 1–1024 bytes                   |   Plain length + 44 | Complete native card, preserving all fields                   |
| 4       | 16-byte identity hash                                                  |            60 bytes | Original identity retained; LXMF address derived on decoding  |
| 5       | Raw destination + recipient-encrypted LXMF paper bytes, 112–2210 bytes |     Raw length + 44 | Existing lxm:// paper message                                 |

Protected bodies contain a random 16-byte salt, 12-byte nonce and AES-256-GCM ciphertext including its 16-byte tag. PBKDF2-HMAC-SHA256 uses 600,000 iterations and the exact UTF-8 password. The 8-byte header is GCM additional authenticated data. CRC catches image damage before password entry; it does not replace authentication. Changes to key derivation or packet layout require an explicit format transition to preserve decoding compatibility.

Native card input is parsed and validated before encoding. RSCP key length, UTF-8 name, field count, kind/capability tokens, identity/public-key binding and LXMF/public-key binding are checked. The decoder validates the recovered card again before display/QR output. Device and capability-bearing cards are preserved in v3 instead of silently becoming personal Legacy contacts.

For a public key `K`, the identity is `SHA256(K)[:16]`. The LXMF destination is `SHA256(SHA256("lxmf.delivery")[:10] || identity_bytes)[:16]`. Concatenation uses bytes, not hexadecimal text. An address-only payload cannot reveal its identity or key.

## Shared error coding

Each byte becomes high-nibble-first Hamming(7,4) words `[p1,p2,d1,p3,d2,d3,d4]`. Each coded bit is repeated three times and majority-voted before Hamming decoding. A packet of N bytes uses 42 physical slots per byte. Header identification, bounded length and CRC protect format detection.

## Original-file profile

`public/lsb-codec.js` embeds one bit in the binary least-significant bit of an RGB channel. A fixed dimension-dependent affine permutation chooses non-repeating channel slots; its stride is coprime with the `3 × width × height` channel capacity. This ordering is public and provides no cryptographic secrecy. Repetition/Hamming are retained.

Every modified rendered RGB channel differs from its original value by at most 1; alpha is not used. Image dimensions are unchanged. Capacity is `floor(3WH/42)` packet bytes; too-small carriers are rejected rather than enlarged. Input transparency is composited onto white before encoding. Canvas PNG serialization is reloaded and verified before download.

This profile requires a lossless original file. JPEG re-encoding, resizing, screenshots, colour processing or other transformations may destroy the low bits. Small visual changes do not imply statistical undetectability.

## Photo profile — experimental, UI default

`public/dct-codec.js` uses 8×8 luminance blocks with a low-amplitude orthonormal DCT coefficient. The basis is `(u,v)=(1,2)` or `(2,1)`, selected by block parity:

`basis(x,y) = 0.25 cos((2x+1)uπ/16) cos((2y+1)vπ/16)`.

Each bit sets the parity of the nearest coefficient quantization index using step 18. The minimal compatible target is approached with up to six RGB correction passes to handle clipping/rounding. The decoder rounds the same coefficient/step and reads its parity, then majority/Hamming/CRC checks apply.

Blocks are row-major then shuffled with xorshift32 seed `0x44535431` and descending Fisher-Yates. Capacity is one physical slot per complete block, so a packet needs N×42 blocks. Small carriers may be enlarged and dimensions round to an 8-pixel grid. Large carriers are never shrunk. Output is a JPEG, tried at quality 85%, then 92% and 97%; the first export that reloads with the exact packet is offered, with PNG as the final fallback. This can add faint texture; it does not promise invisibility or social-platform survival. Tested JPEG qualities are documented separately. Resizing/cropping changes block correspondence and can break recovery.

## Earlier block profile — decoding compatibility

The earlier center-versus-edge profile remains readable (`public/codec.js`). It uses fixed-shuffled 8×8 blocks, seed `0x52535354`, center 4×4 versus the remaining 48 pixels, and signed luminance margins of ±24. This method can produce visible dot/grid artifacts. It is no longer offered as an encoding choice.

The facade tries original-file LSB, gentle DCT and earlier block decoding automatically. Packet header/CRC checks distinguish valid data. If no hidden contact is found, the Decode page also tries ordinary QR reading.

## Contact QR and field output

The ordinary QR reader accepts lxma://, RSCP1 and RSCP2 with bounded gap-closing/downscale retries for rounded/gapped exports. Parsing preserves the native text and individual fields. Native RSCP1/RSCP2 QR output matches the original native text exactly. Legacy or earlier v1 compact-card packets are converted to RSCP1 with an empty name and unpadded base64url for older Ratspeak compatibility. The image never contained their name, so it cannot be recovered. Existing v2 identity-entry packets retained only a destination; their original identity cannot be reconstructed. V4 fixes that for new images.

QR output uses standard byte mode, error correction M and a four-module quiet zone. Copy buttons expose each available decoded field plus the complete card. A legacy URI is retained for compatible personal-contact deep links; it is hidden for device/capability cards to avoid a lossy conversion. Address-only results offer manual Add Contact → Address instructions.

The old image profiles and packet versions remain decodable by the updated app. Older app copies do not understand new profiles or packet versions and must be reloaded. No Reticulum networking, directory lookup or account is implemented in the browser.

## Paper-message transport

An `lxm://` URI is base64url-encoded destination bytes (16) plus recipient-encrypted LXMF message data. It is not a contact card or plaintext message. Packrat structurally checks the outer envelope only, bounds it to 112–2210 bytes using upstream `LXMF_OVERHEAD`/`PAPER_MDU`, and stores those bytes directly rather than the longer base64 text. V5 opens to a canonical unpadded `lxm://` URI. Scheme case, ASCII whitespace, trailing padding and slash separators are normalized as accepted by Ratspeak’s outer parser; malformed/noncanonical base64 is rejected. Ciphertext is unchanged.

An optional Packrat password encrypts that entire outer envelope, including its visible destination, with the same PBKDF2/AES-GCM profile. This is independent from LXMF recipient encryption. A recipient needs the correct Ratspeak identity and, if present, the extra Packrat password. Packrat requests no private keys and does not decrypt the message, verify its sender, compose messages or add messages to a chat. These remain Ratspeak responsibilities.

Without the extra password, the destination is public outer metadata and recovered ciphertext is not authenticated by Packrat. Corrupt or invented paper data can pass a structural check; the recipient must open it in Ratspeak for cryptographic validation.

Both existing image profiles carry paper packets. Photo-mode capacity is one physical slot per 8×8 block, so a maximum-size password-wrapped paper message needs approximately 6.1 megapixels before rounding. Platforms that resize the image may destroy it. Original PNG file delivery avoids that particular recompression/resizing path.

Paper QR output tries error correction M and falls back to L for large links, up to the 2953-character maximum URI. Ordinary paper QRs are accepted on Decode and the paper Encode path. The normal contact output remains at M. Actual camera readability and native import must be tested on the recipient device.

References checked 2026-11-11:

- Ratspeak v1.0.44 runtime: https://github.com/Ratspeak/Ratspeak/blob/v1.0.44/crates/ratspeak-runtime/src/paper.rs
- rsLXMF outer URI format and limits: https://github.com/Ratspeak/rsLXMF/blob/main/crates/lxmf-core/src/message.rs and https://github.com/Ratspeak/rsLXMF/blob/main/crates/lxmf-core/src/constants.rs
- Ratspeak v1.0.43 added native iOS lxm:// handoff: https://github.com/Ratspeak/Ratspeak/releases/tag/v1.0.43
