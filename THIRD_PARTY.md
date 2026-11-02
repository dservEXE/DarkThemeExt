# Third-party notices

This project embeds the Dark Reader API, version 4.9.134.

- Upstream: https://github.com/darkreader/darkreader
- Package: https://registry.npmjs.org/darkreader/-/darkreader-4.9.134.tgz
- License: MIT; see `extension/licenses/DarkReader-MIT.txt`.
- Original source and package SHA-512 provenance are retained in `vendor/`.

The build wraps the API with a private `chrome.runtime` shim so the embedding
API does not replace the extension's actual messaging functions. The controller
uses Dark Reader's existing `Plugins.fetch` hook to fetch page resources with
the extension's HTTP(S) permissions, including cross-origin stylesheets.

One explicit build patch makes the upstream main-world proxy injection
conditional on at least one proxy being enabled. Both proxies are disabled
in this extension. This avoids attempting to run an unused inline script under
Manifest V3's content security policy. The original vendor source is unmodified.

All theme processing happens on the user's device. This extension is not
affiliated with the Dark Reader project or Don State Technical University.
