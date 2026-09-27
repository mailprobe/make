# MailProbe for Make

The [Make](https://www.make.com) app of the [MailProbe API](https://mailprobe.dev/api-docs/): it verifies email addresses in real time, without sending an email.

## Modules

| Module | API call |
| --- | --- |
| Verify an email address | `POST /api/v1/verify` with one address |
| Get credit balance | `GET /api/v1/credits` |
| Make an API call | any path under `https://mailprobe.dev/api` |

The connection asks for a MailProbe API key, created on the [Developer page](https://mailprobe.dev/dashboard/#/developer) of the MailProbe account, and checks it against `GET /api/v1/credits`, which uses no credit. The key is sent only to `mailprobe.dev`.

## How it behaves

- A revoked key raises `InvalidAccessTokenError`: Make deactivates the scenario and tells the user to reconnect.
- `402 NO_CREDITS` fails the run with a link to the pricing page. `402 PAID_ONLY_DOMAIN` depends on the address, so it raises a `DataError`, which Make can keep as an incomplete execution.
- `429` stays a `RateLimitError` and `5xx` a `ConnectionError`, which Make retries. MailProbe refunds the credit of a check that fails on its side.
- A check waits for the recipient's mail server, which can be slow: the app raises Make's 40-second request timeout to 130 seconds, like the MailProbe node for n8n.

## Development

The source follows Make's local development layout: `src/makecomapp.json` lists the components and their files, and the Make Apps Editor for VS Code can open it. `scripts/make-app.mjs` checks the files and deploys them through the [SDK Apps API](https://developers.make.com/api-documentation/api-reference/sdk-apps), with no dependencies:

```bash
node scripts/make-app.mjs check
node scripts/make-app.mjs deploy --icon
```

Deploying needs a Make API token with the `sdk-apps:read` and `sdk-apps:write` scopes, in `MAKE_API_TOKEN` or in `.secrets/apikey` (ignored by git). `branding/make-logo-512.png` is the logo: Make paints its transparent areas in the theme colour `#6C5CE7` and its black areas in white.

## License

MIT
