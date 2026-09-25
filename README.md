# node-canvas

A conversation is a graph, not a list. Bring your own Anthropic key and talk
to it on a canvas of cards: branch any reply, keep every branch.

Desktop only. MIT licensed.

## Run it

Requires Node 22.9+ and pnpm 9.

```bash
pnpm install
cp .env.example .env        # fill DATABASE_URL and KEY_VAULT_ENCRYPTION_KEY
pnpm db:migrate
pnpm dev
```

## Checks

```bash
pnpm check && pnpm lint && pnpm test && pnpm test:db && pnpm test:e2e
```

## How a key is protected

| Question | Answer |
| --- | --- |
| Where does the key live? | `provider_keys.ciphertext` in Postgres. Nowhere else. |
| What encrypts it? | AES-256-GCM under `KEY_VAULT_ENCRYPTION_KEY`, a server-only secret. |
| What does a database dump give an attacker? | Ciphertext, IV, GCM tag and the last four characters. Nothing usable. |
| Can a row be moved to another account? | No. The ciphertext is bound to `<userId>:anthropic` as additional authenticated data. |
