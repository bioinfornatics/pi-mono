import "dotenv/config";

import { stream } from "@mariozechner/pi-ai";

function now() {
  return Date.now();
}

const foundryEndpoint = process.env.AZURE_FOUNDRY_ENDPOINT;
const foundryDeploymentName = process.env.AZURE_FOUNDRY_DEPLOYMENT_NAME;
const foundryApiVersion = process.env.AZURE_FOUNDRY_API_VERSION || "2024-10-21";
const foundryModelId = process.env.AZURE_FOUNDRY_MODEL_ID || "gpt-4o-mini";

const azureOpenAIApiKey = process.env.AZURE_OPENAI_API_KEY;
const azureOpenAIBaseUrl = process.env.AZURE_OPENAI_BASE_URL;
const azureOpenAIApiVersion = process.env.AZURE_OPENAI_API_VERSION || "v1";
const azureOpenAIDeploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;

const useAzureOpenAIKeyMode = Boolean(azureOpenAIApiKey && azureOpenAIBaseUrl);

const context = {
  systemPrompt: "You are a helpful assistant.",
  messages: [{ role: "user", content: "Say: Hello from streaming test", timestamp: now() }],
};

let model;
let options;

if (useAzureOpenAIKeyMode) {
  if (!azureOpenAIDeploymentName) {
    throw new Error("Missing AZURE_OPENAI_DEPLOYMENT_NAME (see env.example)");
  }

  model = {
    id: "azure-openai-test",
    name: "Azure OpenAI (api key test)",
    api: "azure-openai-responses",
    provider: "azure-openai-responses",
    baseUrl: azureOpenAIBaseUrl,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16000,
  };

  options = {
    apiKey: azureOpenAIApiKey,
    azureBaseUrl: azureOpenAIBaseUrl,
    azureApiVersion: azureOpenAIApiVersion,
    azureDeploymentName: azureOpenAIDeploymentName,
    reasoningEffort: "high",
  };

  console.log("Mode: Azure OpenAI /openai/v1 (API key)");
} else {
  if (!foundryEndpoint) throw new Error("Missing AZURE_FOUNDRY_ENDPOINT (see env.example)");
  if (!foundryDeploymentName) throw new Error("Missing AZURE_FOUNDRY_DEPLOYMENT_NAME (see env.example)");

  model = {
    id: foundryModelId,
    name: `Azure Foundry (${foundryModelId})`,
    api: "azure-foundry",
    provider: "azure-foundry",
    baseUrl: foundryEndpoint,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16000,
  };

  options = {
    endpoint: foundryEndpoint,
    apiVersion: foundryApiVersion,
    deploymentName: foundryDeploymentName,
    reasoningEffort: "high",
  };

  console.log("Mode: Azure AI Foundry project endpoint (Entra ID)");
}

const s = stream(model, context, options);

for await (const event of s) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
  if (event.type === "text_end") process.stdout.write("\n");
  if (event.type === "error") console.error("\nERROR:", event.error.errorMessage);
}

const result = await s.result();
console.log("\n\nStop reason:", result.stopReason);
if (result.errorMessage) console.log("Error message:", result.errorMessage);
