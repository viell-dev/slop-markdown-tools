# Obsidian verification dependencies

This Linux Docker harness runs the real Obsidian app in Live Preview and Reading
view. Follow [CONTRIBUTING](../../CONTRIBUTING.md#tests) for workloads, the
verified baseline, explicit latest checks and retained evidence. These
dependencies are separate from the published mdrefine package.

## Download ownership

`wdio-obsidian-service` 3.3.0 uses `obsidian-launcher` 3.3.0 to download the
Obsidian installer and application, and Electron's matching ChromeDriver. It
supplies both executable paths before WebdriverIO starts:

- The Linux AppImage comes from the Obsidian publisher and is extracted with
  `7z-wasm`. The executable is cached under
  `obsidian-installer/linux-x64/Obsidian-VERSION/`.
- The separately selected app arrives as `.asar.gz`; Node's gzip decompressor
  writes `obsidian-app/obsidian-VERSION.asar`.
- `@electron/get` downloads the matching Electron release's ChromeDriver ZIP,
  verifies it against the release's SHA-256 checksums, and `7z-wasm` extracts it
  under `electron-chromedriver/linux-x64/ELECTRON-VERSION/`.

The launcher stages downloads and extraction before publishing a cache entry.
Existing entries are reused. Metadata refreshes after 30 minutes, with valid
cached metadata retained on network failure. The launcher does not revalidate
every existing extracted executable. A missing, non-file or non-executable
browser or driver fails before session startup; investigate that version's
cache entry and the service setup rather than enabling another downloader.

## Provided binaries boundary

The private, locally authored MIT package in `provided-binaries/` replaces
`@puppeteer/browsers` through the harness's direct file dependency and matching
npm override. This is a deliberately smaller contract, not a compatible
Puppeteer fork. It supplies the seven runtime imports used by `@wdio/utils`
9.32.0: browser/channel constants and five functions that fail explicitly when
automatic browser setup is attempted. It downloads and extracts nothing.

The configured Obsidian service already owns all required downloads. Its cold
and warm startup paths were checked before removing the unused fallback. This
removes the installed `extract-zip` and proxy/PAC/get-uri/basic-ftp chains rather
than leaving vulnerable dependencies behind an unused helper. FTP and PAC
configuration retrieval are unsupported here; the active publisher downloads
use HTTPS. General WebdriverIO browser downloading is outside this harness's
contract.

mdrefine maintainers own this small boundary and its executable checks. On a
WDIO or service update, inspect its actual imports and startup behavior before
changing the contract. Remove the replacement only when a supported dependency
path removes the affected FTP and ZIP chains, clean npm resolution/audit proves
that graph, and actual cold/warm Obsidian checks preserve both views, controls,
observed versions and baseline/latest selection. If another automatic download
becomes necessary, revisit [#639] and [#640] before enabling it. A source merge,
published release and verified local adoption are separate events.

`node verify-dependencies.mjs` runs during the image build after `npm ci`. It
checks actual resolution from WebdriverIO, the absent dependency modules, the
real provided-binary branches and explicit missing-binary fallback failures.
`obsidian-dependencies.test.ts` checks the configured session guard and lockfile
in ordinary CI. Native Obsidian jobs exercise the service and actual host; these
offline checks do not replace them.

The `serialize-javascript` 7.1.3 override remains: `@wdio/mocha-framework` 9.32.0
uses Mocha 10.8.2, whose `^6.0.2` range cannot select that verified patch. Remove
the override only when its owning chain disappears, or a supported update
resolves a safely patched version without it and clean installation, audit,
Mocha execution and actual Obsidian evidence pass. This pin is separate from
the removed downloader chains; its presence does not assert a new defect.

## Evidence limits

The container runs as nonroot with a read-only checkout, synthetic documents
and no forwarded credentials. Network access remains enabled; output and the
named download cache are writable. Removing a container does not erase that
cache on a persistent host. Trusted downloads and cache reuse are not proof of
safe extraction of hostile archives, and the unchanged `7z-wasm` path is not a
newly audited archive implementation.

[#639]: https://github.com/viell-dev/slop-markdown-tools/issues/639
[#640]: https://github.com/viell-dev/slop-markdown-tools/issues/640
