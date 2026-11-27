# TokenHarbor usage for DeepSeek Harness

A DeepSeek Harness (DSH) plugin that shows how much of your **TokenHarbor weekly
allowance** is left — the paid **Pass** and the **free-model pool** — as a chip
at the sidebar foot, a popover, and an agent tool.

![The chip at the sidebar foot and the allowance popover it opens](docs/preview.svg)

## What you get

- **A chip at the sidebar foot**, beside Settings. Two bars: the top one is your
  paid Pass, the bottom one is the free-model pool. The numbers on the right are
  the same two percentages. In the collapsed 56 px rail it shrinks to the gauge
  and keeps both percentages in its tooltip.
- **A popover on click**: plan name, both percentages, the reset countdown, the
  free models the pool currently unlocks, the request count for the window, and
  a Refresh button that bypasses the snapshot cache.
- **A `tokenharbor_usage` tool**, so you can ask for the same numbers in chat
  instead of clicking. It takes one optional `refresh` flag.

Both pools are always shown, even at 0% — an empty pool is information too.

## How it reads the allowance

The host half resolves the `TOKENHARBOR_API_KEY` credential and sends one
read-only request to `https://tokenharbor.ai/api/cli/free-tier`, the documented
allowance endpoint. That request spends no tokens and does not consume rate
limit. The key never leaves the host process, and it is re-resolved on every
read, so a rotated key reaches the next call without a restart.

The browser half never talks to TokenHarbor. It fetches the plugin's own route
(`/tokenharbor-usage/usage`) on the DSH web server, which shares one snapshot
with the tool and reuses it for up to 60 seconds.

## Requirements

- DSH with the web GUI (the chip is a client-slot contribution).
- A TokenHarbor account and an API key stored under the credential name
  `TOKENHARBOR_API_KEY`.

If you already use TokenHarbor as a model provider in DSH, that credential is
already in place: the provider's `apiKeyEnv` points at the same name, so there is
nothing else to configure. Otherwise store the key in the Harness credential
store under `TOKENHARBOR_API_KEY` — the same store provider keys live in. The
plugin asks the credentials service for it; it never reads your files directly.

## Install

```sh
git clone https://github.com/hanshalwi/dsh-tokenharbor-usage.git
```

Then install the folder as a DSH profile bundle. Ask your agent to run the plugin
manager's `install_bundle` action with the absolute path of the cloned folder, or
use the local-bundle installer in Settings → Plugins. The bundle is linked, not
copied, so `git pull` updates it.

Reload the page; the chip appears at the sidebar foot. If it does not, toggle the
bundle off and on in Settings → Plugins — a replaced bundle needs a fresh JS
module generation, which a disable/enable cycle provides.

## Security notes

- The key is sent only to `https://tokenharbor.ai`, over HTTPS, from the host
  process. It is never logged, never returned by the route, and never reaches the
  browser.
- The route carries no credential of its own. It refuses writes (`405`,
  `Allow: GET, HEAD`) and refuses requests another site made (`sec-fetch-site:
  cross-site` → `403`). Any other process that can reach your DSH web port can
  still read the percentages and request count — nothing more, and nothing that
  identifies your key.
- The plugin reads no files, opens no sockets beyond that one HTTPS request, and
  stores nothing.

## Uninstall

Disable or remove the bundle in Settings → Plugins. The chip and the tool
disappear; your allowance and your credential are untouched.

## Development

No dependencies, no build step. Two halves, both plain JavaScript:

| File | Role |
| --- | --- |
| `index.js` | Host half: the tool, the HTTP route, the credential read, the 60 s snapshot |
| `client.js` | Browser half: the chip and the popover, loaded through the client module table |
| `locale/*.json` | Plugin title and description for the plugin list |
| `docs/DETAIL*.md` | One-image detail page per language |

```sh
npm test          # or: node test/host-tool.mjs && node test/client-render.cjs
```

Both suites run offline on Node 20+: `test/host-tool.mjs` stubs `fetch` and the
DSH context to check the tool, the route, the cache and every failure path;
`test/client-render.cjs` renders the chip and popover with a small React shim to
check every state, including the collapsed rail.

## License

MIT — see [LICENSE](LICENSE). Not affiliated with TokenHarbor.