# Sharing Regression

Run `npm run test:sharing` against a configured, running vitrine preview.
Playwright must be available in the local dependencies or through `NODE_PATH`.
The Codex bundled Playwright runtime can be used without adding a browser library to the storefront bundle.

- `VITRINE_URL`: preview URL, defaults to `http://127.0.0.1:5182/vitrine/`.
- `PLAYWRIGHT_CHANNEL`: installed browser channel, defaults to `chrome`.
- `QA_OUTPUT_DIR`: screenshots and results, defaults to `../design-review/share-options`.

This is a separate browser check, not part of the unit-only `npm test` command.
It reads the configured public catalog; analytics writes and messenger destinations are intercepted.
No messages are sent. Native sharing and clipboard behavior are stubbed to cover unsupported APIs, failures, cancellation and pending operations.
Viewport emulation does not replace verification of the actual Android or iOS system share sheet on a physical phone.
