# Security and privacy

The application has no upload endpoint, network API, analytics, external fonts or persistent application storage. Selected files are decoded into browser memory. Scripts, styles, fonts and QR libraries come from the same static distribution. A restrictive Content Security Policy disables connection APIs and remote scripts; GitHub Pages receives that policy through HTML metadata. A host can still replace the application or its policy, so this is not protection from a malicious distributor.

The host can observe page/asset requests, IP addresses and timing. A VPN shifts which party can see the source address; Tor changes routing and observations. Neither prevents a compromised site from serving altered JavaScript. A reviewed downloaded copy can run offline without contacting the website again. Offline copies do not update automatically. Authenticate releases through a trusted channel; SHA256SUMS alone does not establish who published them.

Steganography hides a small contact packet in pixels. It is detectable by software and may create visible changes, especially in flat images. Packet shuffling is public and provides no secrecy. Password protection encrypts the contact with PBKDF2-HMAC-SHA256 (600,000 iterations) and AES-256-GCM (128-bit tag), with a random 128-bit salt and a random 96-bit nonce for every encoding. Offline password guessing remains possible. CRC and error correction detect/repair accidental damage; unencrypted payloads are not authenticated. No original cryptographic primitive is used, but the implementation has not received an independent security audit.

Cards are checked for public-key/identity/address consistency. That does not verify the person's real identity or prevent someone sharing another person's valid card. Confirm sensitive contacts through a trusted channel. Ratspeak remains responsible for importing and using a card.

Browser memory, extensions, screenshots, clipboard, downloads and browser caches may expose material. Clear session resets application references and inputs; it is not guaranteed memory erasure. A shared or compromised device remains outside this tool's protection.

Report a suspected vulnerability privately to the repository maintainer using GitHub's private vulnerability reporting if enabled. Do not put real contacts, passwords or private images in public issues. If reporting is not yet enabled, ask the maintainer for a private channel using a minimal issue without exploit details. Do not assume an unconfigured contact address.

## Password guidance sources

The PBKDF2 work factor follows OWASP’s current PBKDF2-HMAC-SHA256 password-hashing recommendation: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2. This is used as a benchmark for offline guessing cost; it does not make weak passwords safe.

NIST SP 800-63B-4 emphasizes password length, avoiding forced character mixtures, and supporting password managers/pasting. Its 15-character minimum applies to single-factor account authentication, not a guarantee for offline file encryption: https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver. Packrat’s local passphrase is not an account password, and this tool does not claim NIST certification or FIPS validation. It does not query breach databases or estimate password entropy. Spaces, long passwords and Unicode are accepted without truncation; exact UTF-8 input is used, so different Unicode representations or added spaces produce different keys.

For offline encryption, a unique passphrase of six randomly selected words from EFF’s long wordlist is a practical recommendation: https://www.eff.org/dice. Forgotten passphrases cannot be reset, and recipients should receive them through a separate channel.

## LXMF paper messages

Paper links already carry data encrypted for a recipient. Packrat transports an existing link, checks its outer syntax/length, and can apply an additional password; that does not read or authenticate its message. Ratspeak must decrypt and check it with the intended recipient’s identity. A parsed recipient address is unverified public metadata, not proof of ownership or a valid sender. No LXMF private key is requested or imported. A password on the Packrat image is separate from recipient identity encryption.

## Dependency maintenance

Build and test tools are pinned in package-lock.json, with registry integrity hashes. CI installs with dependency lifecycle scripts disabled and verifies npm advisories, registry signatures and provenance attestations. GitHub Actions are pinned to full commit hashes. These checks help detect known vulnerabilities and unexpected package origins; they do not prove that code is free of malicious behavior or undiscovered flaws.

The browser uses checked-in QR libraries, fonts and artwork, without runtime CDN downloads. Their versions and origins are recorded in THIRD_PARTY_NOTICES.md. Vendored browser files are outside npm's dependency audit and need separate upstream advisory checks when reviewing updates. Keep Node and the test/user browsers on current security patches. Review dependency and workflow changes before merging.
