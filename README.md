# Packrat

Hide a Ratspeak contact or recipient-encrypted paper message in a picture, then recover it in your browser.

**Everything runs locally in your browser.** Images, contacts, paper links and passwords are never uploaded. No accounts, analytics or saved application history. The website host can still observe visits and downloads.

## Use

1. Choose **Encode**, then what to include: a full contact card, paper message, LXMF address or identity hash. A full contact card includes the public key needed to import the contact directly.
2. Paste the value or choose a saved contact/paper QR, then choose a JPG or PNG picture.
3. Choose **Send as a photo** for a compact JPEG with experimental compression tolerance, or **Send as a file** for the smallest pixel changes. File mode requires sharing the original output PNG without compression or resizing.
4. Optionally add a unique password, then encode and download the image. Prefer six randomly generated words; anyone holding the image can guess passwords offline. There is no password reset.

To recover data, choose **Decode** and select the received image. Enter its password if prompted, then copy individual fields, copy the complete card/link, or scan the recovered QR in Ratspeak. Ordinary contact and paper QRs are also supported.

Supported formats: `lxma://`, RSCP1 and RSCP2 contact cards, LXMF addresses, identity hashes and existing `lxm://` paper-message links. Packrat carries paper links; Ratspeak creates, decrypts and authenticates their messages.

If a recovered paper link does not open Ratspeak, copy it and open the app manually with the intended recipient identity active. Enable **Settings → General → Paper messages**, then **Messages → New conversation (pencil) → Paper**. Paste the link, choose **Review**, then **Add to chat**.

## Offline use

Choose **Download offline app** in the app. Save the HTML file and open it in a modern browser to work without a connection. It includes its scripts, fonts and license notices. Offline copies do not update automatically. Browser clipboard restrictions may require manually copying the selected text.

## Development

Requires up-to-date Node 24 LTS (minimum 24.22.3) and npm. From a checkout:

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://localhost:5173/`. Restart the development command after source edits.

```sh
npm test
npm run build
npm run test:browser
```

The build writes the static site to `dist/`, including the standalone `packrat-offline.html`. Browser tests require an installed, up-to-date, sandboxed Google Chrome; they do not download a browser. Use `CHROME_PATH` or `CHROME_CHANNEL` to select another compatible installation.

## GitHub Pages

In the repository's **Settings → Pages**, select **GitHub Actions**. Run **Actions → Deploy GitHub Pages** on `main`. The workflow tests, builds and deploys `dist/`. Asset paths support repository subpaths and custom domains. Deployment is manual.

For another static host, run `npm ci --ignore-scripts` and `npm run build`, then serve `dist/` over HTTPS. No backend or API keys are needed.

## Security

Photo transport is experimental. Compression, cropping, resizing and screenshots can destroy hidden data; test the image received at the other end. Steganography does not guarantee undetectability. Optional password protection uses PBKDF2-HMAC-SHA256 (600,000 iterations) and AES-256-GCM. Its protection depends on password strength.

**Packrat has not received an independent security audit.** See [SECURITY.md](SECURITY.md) for limitations and [PROTOCOL.md](PROTOCOL.md) for the image and packet formats.

## License and credits

Original code is [MIT licensed](LICENSE). Bundled libraries, fonts and rat artwork retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).

Inspired by [Benn Jordan's steganography experiments](https://www.bennjordan.com/blog/stego-links). Compatible with [Ratspeak](https://ratspeak.org/); this is an independent project.
