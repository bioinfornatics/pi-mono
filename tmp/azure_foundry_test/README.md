# azure_foundry_test

Temporary local project for testing the **azure-foundry** provider in this repo.

## Modes

### Mode A: Azure AI Foundry project endpoint (Entra ID)

- Uses `api=azure-foundry`
- Auth: `DefaultAzureCredential` (typically `az login`)

### Mode B: Azure OpenAI /openai/v1 endpoint (API key)

- Uses `api=azure-openai-responses`
- Auth: `AZURE_OPENAI_API_KEY`
- Important: this is **not** the Foundry project endpoint.

## Setup

1. Create `.env` from `env.example` (or `ennv.example`) and fill values.

## Run

```bash
cd tmp/azure_foundry_test
npm install
npm run start
```

## Debug Entra token via Azure CLI

This checks whether Azure CLI auth is actually usable from Node.js.

```bash
cd tmp/azure_foundry_test
npm install
npm run debug:cli-token
```
