# MailProbe

[MailProbe](https://mailprobe.dev) verifies email addresses in real time: it asks the recipient's mail server whether the mailbox exists, without sending an email.

## Connect MailProbe to Make

1. Sign in to your [MailProbe account](https://mailprobe.dev/login/). A new account gets free credits.
2. On the [Developer page](https://mailprobe.dev/dashboard/#/developer), create an API key and copy it. MailProbe shows a key only once, when you create it.
3. In Make, add a MailProbe module to a scenario, click **Create a connection** and paste the key in **API key**.

Make checks the key by reading your credit balance, which uses no credit.

## Modules

- **Verify an email address** returns the verdict for one address: status (`valid`, `risky`, `invalid` or `unknown`), result, score from 0 to 100, reason, suggested correction for a mistyped domain, and the details of the check. Each verification uses one credit.
- **Get credit balance** returns the number of credits left.
- **Make an API call** sends any request to the [MailProbe API](https://mailprobe.dev/api-docs/) with your connection.

## Errors

- An invalid or revoked API key deactivates the scenario: create a new key and update the connection.
- When the credits run out, the run fails with a link to the [pricing page](https://mailprobe.dev/pricing/). Addresses at a few domains can only be checked with purchased credits: with **Allow storing of incomplete executions** on, such a bundle waits in the incomplete executions until you buy credits.
- The API accepts 60 requests per minute per key. Past that, Make pauses the scenario for a while and resumes it.
- When a check fails on MailProbe's side, the credit is refunded and Make retries later.

A check usually takes a few seconds. A slow mail server can hold it longer, so the app waits up to 130 seconds for an answer.
