import "dotenv/config";

import { AzureCliCredential } from "@azure/identity";

const endpoint = process.env.AZURE_FOUNDRY_ENDPOINT || process.env.AZURE_AI_FOUNDRY_ENDPOINT || process.env.AI_FOUNDRY_PROJECT_ENDPOINT;
const tenantId = process.env.AZURE_TENANT_ID;
const scope = "https://cognitiveservices.azure.com/.default";

if (!endpoint) throw new Error("Missing AZURE_FOUNDRY_ENDPOINT (or AZURE_AI_FOUNDRY_ENDPOINT / AI_FOUNDRY_PROJECT_ENDPOINT)");

const cred = tenantId ? new AzureCliCredential({ tenantId }) : new AzureCliCredential();
const token = await cred.getToken(scope);
if (!token?.token) throw new Error("AzureCliCredential did not return a token");

const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token.token}` } });
console.log("status", res.status);
console.log(await res.text());
