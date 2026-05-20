import { describe, expect, it } from "vitest";

import { runReflector, normalizeSupportingObservationIds } from "../src/agents/reflector/agent.js";
import { hashId } from "../src/ids.js";
import { estimateStringTokens } from "../src/tokens.js";
import { observation, reflection } from "./fixtures/session.js";

function fakeAgentLoop(handler: (prompts: any[], context: any, config: any) => Promise<void> | void): any {
	return ((prompts: any[], context: any, config: any) => ({
		async *[Symbol.asyncIterator]() {},
		result: async () => {
			await handler(prompts, context, config);
			return {};
		},
	})) as any;
}

describe("V3 reflector agent", () => {
	const obsA = observation("aaaaaaaaaaaa");
	const obsB = observation("bbbbbbbbbbbb");
	const baseArgs = {
		model: {} as any,
		apiKey: "test",
		reflections: [],
		observations: [obsA, obsB],
	};

	it("keeps core reflector prompt guidance in V3 terms", async () => {
		let systemPrompt = "";
		const loop = fakeAgentLoop((_prompts, context) => {
			systemPrompt = context.systemPrompt;
		});

		await runReflector({ ...baseArgs, agentLoop: loop });

		expect(systemPrompt).toContain("Your task is different from the observer");
		expect(systemPrompt).toContain("User assertions are authoritative");
		expect(systemPrompt).toContain("supportingObservationIds");
		expect(systemPrompt).toContain("coverage/provenance set");
		expect(systemPrompt).toContain("Do not lightly reword existing reflections");
		expect(systemPrompt).toContain("Reflections are scarce, expensive durable orientation anchors");
		expect(systemPrompt).toContain("not a second observation layer");
		expect(systemPrompt).toContain("Over-reflection is also memory distortion");
		expect(systemPrompt).toContain("makes transient details look durable");
		expect(systemPrompt).toContain("Decision procedure:");
		expect(systemPrompt).toContain("First reject observations that are transient, low-level, partial, routine, or only useful as current working state");
		expect(systemPrompt).toContain("future-agent utility test");
		expect(systemPrompt).toContain("avoid a wrong decision, repeated work, or user-preference violation");
		expect(systemPrompt).toContain("If the candidate fails that future-agent utility test, leave it as an observation");
		expect(systemPrompt).toContain("If unsure, emit no reflection");
		expect(systemPrompt).toContain("High and critical observations deserve careful review, not automatic reflection");
		expect(systemPrompt).toContain("Do not turn each observation into a reflection");
		expect(systemPrompt).toContain("Observations are evidence; reflections are compressed durable conclusions");
		expect(systemPrompt).toContain("Single-observation reflections are allowed");
		expect(systemPrompt).toContain("durable user preference, constraint, correction, decision, invariant, completed outcome, or long-lived blocker");
		expect(systemPrompt).toContain("Do not copy or lightly paraphrase observation lines");
		expect(systemPrompt).toContain("Prefer fewer, higher-value reflections");
		expect(systemPrompt).toContain("zero reflections than to create one reflection per observation");
		expect(systemPrompt).toContain("Most transient task-log observations");
		expect(systemPrompt).toContain("files inspected, commands run, failed attempts, partial implementation, and current working state");
		expect(systemPrompt).toContain("supportingObservationIds are not a checklist");
		expect(systemPrompt).toContain("BAD: completed: edited src/hooks/reflect-drop-trigger.ts");
		expect(systemPrompt).toContain("GOOD: completed: V3 reflect/drop coverage now uses raw progress watermarks");
		expect(systemPrompt).toContain("BAD: npm test passed");
		expect(systemPrompt).toContain("GOOD: completed: V3 package namespace migration passed full tests and typecheck");
		expect(systemPrompt).toContain("ZERO REFLECTIONS: The only new observations are files inspected, commands run, failed attempts, partial implementation, transient debugging, or current working state with no durable conclusion yet");
		expect(systemPrompt).toContain("Focus on:");
		expect(systemPrompt).toContain("User identity, role, preferences, constraints");
		expect(systemPrompt).toContain("Project goals, architecture, technical decisions");
		expect(systemPrompt).toContain("Recurring user behavior or preferences");
		expect(systemPrompt).toContain("Completed outcomes future runs must not redo");
		expect(systemPrompt).toContain("Durable blockers, invariants, and open decisions");
		expect(systemPrompt).toContain("Reflection content rules");
		expect(systemPrompt).toContain("Lead with the fact or pattern");
		expect(systemPrompt).not.toContain("legacy/no-provenance");
		expect(systemPrompt).not.toContain("pruner");
		expect(systemPrompt).not.toContain("[coverage:");
		expect(systemPrompt).not.toContain("Pass strategy");
	});

	it("normalizes supporting observation ids by active observation order", () => {
		expect(normalizeSupportingObservationIds(["bbbbbbbbbbbb", "aaaaaaaaaaaa", "aaaaaaaaaaaa"], ["aaaaaaaaaaaa", "bbbbbbbbbbbb"])).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
		expect(normalizeSupportingObservationIds(["aaaaaaaaaaaa", "missing"], ["aaaaaaaaaaaa"])).toBeUndefined();
		expect(normalizeSupportingObservationIds([], ["aaaaaaaaaaaa"])).toBeUndefined();
	});

	it("records one-line V3 reflections with code-computed ids and token counts", async () => {
		const content = "User prefers source-backed memory.";
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				reflections: [{ content, supportingObservationIds: ["bbbbbbbbbbbb", "aaaaaaaaaaaa"] }],
			});
		});

		const result = await runReflector({ ...baseArgs, agentLoop: loop });

		expect(result).toEqual([{ id: hashId(content), content, supportingObservationIds: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"], tokenCount: estimateStringTokens(content) }]);
	});

	it("rejects invented support ids and multiline content", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				reflections: [
					{ content: "Bad support", supportingObservationIds: ["missing"] },
					{ content: "Two\nlines", supportingObservationIds: ["aaaaaaaaaaaa"] },
				],
			});
		});

		await expect(runReflector({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("dedupes proposals and skips existing reflection ids", async () => {
		const content = "User prefers terse updates.";
		const existing = reflection(hashId(content), ["aaaaaaaaaaaa"], { content });
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", {
				reflections: [
					{ content, supportingObservationIds: ["aaaaaaaaaaaa"] },
					{ content: "New durable fact.", supportingObservationIds: ["aaaaaaaaaaaa"] },
					{ content: "New durable fact.", supportingObservationIds: ["bbbbbbbbbbbb"] },
				],
			});
		});

		const result = await runReflector({ ...baseArgs, reflections: [existing], agentLoop: loop });

		expect(result?.map((item) => item.content)).toEqual(["New durable fact."]);
	});

	it("returns undefined when no tool call records reflections", async () => {
		const loop = fakeAgentLoop(() => {});
		await expect(runReflector({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});
});
