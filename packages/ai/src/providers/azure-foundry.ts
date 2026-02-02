import { AIProjectClient } from "@azure/ai-projects";
import type { TokenCredential } from "@azure/core-auth";
import { DefaultAzureCredential } from "@azure/identity";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";

import { supportsXhigh } from "../models.js";
import type {
	Api,
	AssistantMessage,
	AzureFoundryResponsesOptions,
	Context,
	Model,
	SimpleStreamOptions,
	StopReason,
	StreamFunction,
	ThinkingLevel,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { convertResponsesMessages, convertResponsesTools, processResponsesStream } from "./openai-responses-shared.js";
import { clampReasoning } from "./simple-options.js";

const DEFAULT_FOUNDRY_API_VERSION = "2024-10-21";
const DEFAULT_STOP_REASON: StopReason = "stop";

const TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode", "azure-openai-responses", "azure-foundry"]);

function parseDeploymentNameMap(value: string | undefined): Map<string, string> {
	const map = new Map<string, string>();
	if (!value) return map;
	for (const entry of value.split(",")) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const [modelId, deploymentName] = trimmed.split("=", 2);
		if (!modelId || !deploymentName) continue;
		map.set(modelId.trim(), deploymentName.trim());
	}
	return map;
}

function resolveDeploymentName(model: Model<"azure-foundry">, options?: AzureFoundryResponsesOptions): string {
	if (options?.deploymentName) return options.deploymentName;
	const env = typeof process !== "undefined" ? process.env.AZURE_FOUNDRY_DEPLOYMENT_NAME_MAP : undefined;
	const mapped = parseDeploymentNameMap(env).get(model.id);
	return mapped || model.id;
}

function assertFoundryProjectEndpoint(endpoint: string): void {
	const lower = endpoint.toLowerCase();
	if (lower.includes(".openai.azure.com") || lower.includes("/openai/v1")) {
		throw new Error(
			"azure-foundry expects an Azure AI Foundry project endpoint like https://<resource>.services.ai.azure.com/api/projects/<project>. " +
				"This endpoint looks like Azure OpenAI v1 (/openai/v1). Use api=azure-openai-responses instead.",
		);
	}
	if (!lower.includes(".services.ai.azure.com") || !lower.includes("/api/projects/")) {
		throw new Error(
			"azure-foundry expects an Azure AI Foundry project endpoint like https://<resource>.services.ai.azure.com/api/projects/<project>. " +
				"Got: " +
				endpoint,
		);
	}
}

function maxTokensDefault(model: Model<Api>): number {
	return Math.min(model.maxTokens, 32000);
}

function toReasoningEffort(
	model: Model<"azure-foundry">,
	reasoning: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
	return supportsXhigh(model) ? reasoning : clampReasoning(reasoning);
}

export const streamAzureFoundry: StreamFunction<"azure-foundry", AzureFoundryResponsesOptions> = (
	model: Model<"azure-foundry">,
	context: Context,
	options?: AzureFoundryResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "azure-foundry" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: DEFAULT_STOP_REASON,
			timestamp: Date.now(),
		};

		try {
			if (!options?.endpoint) {
				throw new Error("azure-foundry: missing required option 'endpoint'");
			}
			if (options.apiKey) {
				throw new Error(
					"azure-foundry: API key auth is not supported for Foundry project endpoints. Use Entra ID (DefaultAzureCredential). " +
						"For /openai/v1 endpoints, use api=azure-openai-responses.",
				);
			}
			const endpoint = options.endpoint.trim();
			assertFoundryProjectEndpoint(endpoint);

			const apiVersion = options.apiVersion ?? DEFAULT_FOUNDRY_API_VERSION;
			const credential: TokenCredential = options.credential ?? new DefaultAzureCredential();
			const project = new AIProjectClient(endpoint, credential);
			const client = await project.getAzureOpenAIClient({ apiVersion });
			const deploymentName = resolveDeploymentName(model, options);

			const reasoningEffort = toReasoningEffort(model, options.reasoningEffort);
			const input = convertResponsesMessages(model, context, TOOL_CALL_PROVIDERS);
			const params: ResponseCreateParamsStreaming = {
				model: deploymentName,
				input,
				stream: true,
				prompt_cache_key: options.sessionId,
			};

			if (options.maxTokens) params.max_output_tokens = options.maxTokens;
			if (options.temperature !== undefined) params.temperature = options.temperature;
			if (context.tools) params.tools = convertResponsesTools(context.tools);

			if (model.reasoning) {
				if (options.reasoningEffort || options.reasoningSummary) {
					params.reasoning = {
						effort: reasoningEffort || "medium",
						summary: options.reasoningSummary || "auto",
					};
					params.include = ["reasoning.encrypted_content"];
				} else {
					if (model.name.toLowerCase().startsWith("gpt-5")) {
						// Jesus Christ, see https://community.openai.com/t/need-reasoning-false-option-for-gpt-5/1351588/7
						input.push({
							role: "developer",
							content: [{ type: "input_text", text: "# Juice: 0 !important" }],
						});
					}
				}
			}

			options.onPayload?.(params);

			const openaiStream = await client.responses.create(
				params,
				options.signal ? { signal: options.signal } : undefined,
			);

			stream.push({ type: "start", partial: output });
			await processResponsesStream(openaiStream, output, stream, model);

			if (options.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as { index?: number }).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleAzureFoundry: StreamFunction<"azure-foundry", SimpleStreamOptions> = (
	model: Model<"azure-foundry">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const endpoint = (
		(typeof process !== "undefined" ? process.env.AZURE_FOUNDRY_ENDPOINT : undefined) ||
		(typeof process !== "undefined" ? process.env.AZURE_AI_FOUNDRY_ENDPOINT : undefined)
	)?.trim();

	if (!endpoint) {
		throw new Error(
			"Azure Foundry endpoint is required. Set AZURE_FOUNDRY_ENDPOINT to your project endpoint " +
				"(https://<resource>.services.ai.azure.com/api/projects/<project>) or pass { endpoint } to stream().",
		);
	}

	if (options?.apiKey) {
		throw new Error(
			"azure-foundry: API key auth is not supported for Foundry project endpoints. Use Entra ID (DefaultAzureCredential).",
		);
	}

	const apiVersion =
		(typeof process !== "undefined" ? process.env.AZURE_FOUNDRY_API_VERSION : undefined) ??
		(typeof process !== "undefined" ? process.env.AZURE_AI_FOUNDRY_API_VERSION : undefined) ??
		DEFAULT_FOUNDRY_API_VERSION;

	return streamAzureFoundry(model, context, {
		endpoint,
		apiVersion,
		temperature: options?.temperature,
		maxTokens: options?.maxTokens ?? maxTokensDefault(model),
		signal: options?.signal,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		reasoningEffort: toReasoningEffort(model, options?.reasoning),
	} satisfies AzureFoundryResponsesOptions);
};
