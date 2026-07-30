# EasyTran

Fast, readable transcripts from supported video URLs.

EasyTran turns supported video captions into searchable, timestamped text with
clean exports and an optional AI fallback when a usable subtitle track is not
available.

## Product

- Free browser-based transcript flow
- Searchable timestamped output
- JSON, TXT, SRT, and VTT exports
- API and dashboard plans for production workflows
- Batch, webhook, channel-sync, and archive capabilities on eligible plans

## Local development

```bash
npm install
npm run dev
```

The Vite frontend runs locally with the Node API. Copy the example environment
file and configure only the providers required for the feature you are testing.
Never commit API keys or production credentials.

## Quality checks

```bash
npm run lint
npm test
npm run build
```

Product documentation lives at `/docs`. Deployment and HTTPS notes are kept in
`DEPLOYMENT.md`.

[easytran.app](https://easytran.app)
