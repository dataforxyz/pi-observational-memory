import { describe, expect, it } from "vitest";

import {
	dropUrgencyForFullness,
	maxDropCountForPool,
	normalizeDropObservationIds,
	observationPoolFullness,
	runDropper,
	selectDropCandidates,
} from "../src/agents/dropper/agent.js";
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

describe("V3 dropper agent", () => {
	const obsA = observation("aaaaaaaaaaaa", { relevance: "medium" });
	const obsB = observation("bbbbbbbbbbbb", { relevance: "low" });
	const critical = observation("cccccccccccc", { relevance: "critical" });
	const baseArgs = {
		model: {} as any,
		apiKey: "test",
		reflections: [reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"])],
		observations: [obsA, obsB, critical],
		budgetTokens: 10,
	};

	it("computes observation pool fullness defensively", () => {
		expect(observationPoolFullness(0, 100)).toBe(0);
		expect(observationPoolFullness(-1, 100)).toBe(0);
		expect(observationPoolFullness(10, 0)).toBe(0);
		expect(observationPoolFullness(10, Number.NaN)).toBe(0);
		expect(observationPoolFullness(25, 100)).toBe(0.25);
	});

	it("maps pool fullness to drop urgency thresholds", () => {
		expect(dropUrgencyForFullness(0.29)).toBe("low");
		expect(dropUrgencyForFullness(0.30)).toBe("medium");
		expect(dropUrgencyForFullness(0.59)).toBe("medium");
		expect(dropUrgencyForFullness(0.60)).toBe("high");
	});

	it("computes max drops from pool fullness", () => {
		const observations = Array.from({ length: 10 }, (_, index) =>
			observation(`${index}`.padStart(12, "a"), { relevance: "low", tokenCount: 10 }),
		);

		expect(maxDropCountForPool(observations, 9, 100)).toBe(0);
		expect(maxDropCountForPool(observations, 10, 100)).toBe(1);
		expect(maxDropCountForPool(observations, 55, 100)).toBe(3);
		expect(maxDropCountForPool(observations, 100, 100)).toBe(5);
		expect(maxDropCountForPool(observations, 200, 100)).toBe(5);
	});

	it("excludes critical observations from the max-drop denominator", () => {
		const observations = [
			observation("aaaaaaaaaaaa", { relevance: "low" }),
			observation("bbbbbbbbbbbb", { relevance: "medium" }),
			observation("cccccccccccc", { relevance: "critical" }),
			observation("dddddddddddd", { relevance: "critical" }),
		];

		expect(maxDropCountForPool(observations, 100, 100)).toBe(1);
	});

	it("keeps core dropper safety guidance in V3 terms", async () => {
		let systemPrompt = "";
		const loop = fakeAgentLoop((_prompts, context) => {
			systemPrompt = context.systemPrompt;
		});

		await runDropper({ ...baseArgs, agentLoop: loop });

		expect(systemPrompt).toContain("Active-memory framing");
		expect(systemPrompt).toContain("Age-gradient rule");
		expect(systemPrompt).toContain("critical");
		expect(systemPrompt).toContain("NEVER drop");
		expect(systemPrompt).toContain("User assertions and concrete completions are never droppable");
		expect(systemPrompt).toContain("Preservation floor");
		expect(systemPrompt).toContain("Do not force drops");
		expect(systemPrompt).toContain("You cannot merge observations");
		expect(systemPrompt).toContain("Default action is KEEP");
		expect(systemPrompt).toContain("When uncertain, keep");
		expect(systemPrompt).toContain("low urgency");
		expect(systemPrompt).toContain("high urgency");
		expect(systemPrompt).toContain("preservation rules do not weaken");
		expect(systemPrompt).not.toContain("drop freely");
		expect(systemPrompt).not.toContain("pruner");
		expect(systemPrompt).not.toContain("[coverage:");
		expect(systemPrompt).not.toContain("Pass strategy");
	});

	it("passes urgency and integer max drops as a hard upper bound", async () => {
		let userText = "";
		const loop = fakeAgentLoop((prompts) => {
			userText = prompts[0].content[0].text;
		});

		await runDropper({ ...baseArgs, agentLoop: loop });

		expect(userText).toContain("fullness: ~300%");
		expect(userText).toContain("Drop urgency: high");
		expect(userText).toContain("Maximum drops allowed this run: 1 observation");
		expect(userText).toContain("hard upper bound, not a target");
		expect(userText).toContain("Drop fewer or none");
	});

	it("normalizes active drop ids, filters invalid ids, dedupes, and protects critical observations", () => {
		expect(normalizeDropObservationIds(["bbbbbbbbbbbb", "missing", "bbbbbbbbbbbb", "cccccccccccc", "aaaaaaaaaaaa"], [obsA, obsB, critical])).toEqual(["bbbbbbbbbbbb", "aaaaaaaaaaaa"]);
		expect(normalizeDropObservationIds(["missing", "cccccccccccc"], [obsA, obsB, critical])).toBeUndefined();
	});

	it("selects final candidates by lower relevance first with stable ordering", () => {
		const highA = observation("aaaaaaaaaaaa", { relevance: "high" });
		const lowA = observation("bbbbbbbbbbbb", { relevance: "low" });
		const medium = observation("dddddddddddd", { relevance: "medium" });
		const lowB = observation("eeeeeeeeeeee", { relevance: "low" });
		const highB = observation("ffffffffffff", { relevance: "high" });
		const critical = observation("111111111111", { relevance: "critical" });
		const observations = [highA, lowA, medium, lowB, highB, critical];

		expect(selectDropCandidates([
			"aaaaaaaaaaaa",
			"missing",
			"111111111111",
			"bbbbbbbbbbbb",
			"dddddddddddd",
			"bbbbbbbbbbbb",
			"eeeeeeeeeeee",
			"ffffffffffff",
		], observations, 3)).toEqual(["bbbbbbbbbbbb", "eeeeeeeeeeee", "dddddddddddd"]);
	});

	it("returns capped lower-relevance proposed observation ids", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", { ids: ["aaaaaaaaaaaa", "missing", "bbbbbbbbbbbb"] });
		});

		await expect(runDropper({ ...baseArgs, agentLoop: loop })).resolves.toEqual(["bbbbbbbbbbbb"]);
	});

	it("returns undefined when only invalid or protected ids are proposed", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", { ids: ["missing", "cccccccccccc"] });
		});

		await expect(runDropper({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("dedupes repeated tool calls and enforces one run-level cap", async () => {
		const loop = fakeAgentLoop(async (_prompts, context) => {
			await context.tools[0].execute("tool-1", { ids: ["aaaaaaaaaaaa"] });
			await context.tools[0].execute("tool-2", { ids: ["bbbbbbbbbbbb", "aaaaaaaaaaaa"] });
		});

		await expect(runDropper({ ...baseArgs, agentLoop: loop })).resolves.toEqual(["bbbbbbbbbbbb"]);
	});

	it("returns undefined when no tool call drops observations", async () => {
		const loop = fakeAgentLoop(() => {});
		await expect(runDropper({ ...baseArgs, agentLoop: loop })).resolves.toBeUndefined();
	});

	it("skips the model below ten percent pool fullness", async () => {
		let called = false;
		const loop = fakeAgentLoop(() => {
			called = true;
		});

		await expect(runDropper({
			...baseArgs,
			observations: [observation("aaaaaaaaaaaa", { relevance: "low", tokenCount: 9 })],
			budgetTokens: 100,
			agentLoop: loop,
		})).resolves.toBeUndefined();
		expect(called).toBe(false);
	});
});
