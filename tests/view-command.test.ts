import { describe, expect, it, vi } from "vitest";

import { registerViewCommand } from "../src/commands/view.js";
import {
	compactionEntry,
	memoryDetails,
	observation,
	observationsDroppedEntry,
	observationsRecordedEntry,
	oldV2CompactionDetails,
	oldV2ObservationEntry,
	reflection,
	reflectionsRecordedEntry,
	textCustomMessage,
	type TestEntry,
} from "./fixtures/session.js";

function setup(entries: TestEntry[]) {
	let handler: ((args: unknown, ctx: any) => Promise<void>) | undefined;
	const pi = {
		registerCommand: vi.fn((name: string, command: { handler: typeof handler }) => {
			expect(name).toBe("om-view");
			handler = command.handler;
		}),
	};
	const runtime = { ensureConfig: vi.fn() };
	registerViewCommand(pi as any, runtime as any);
	if (!handler) throw new Error("view handler not registered");
	const notify = vi.fn();
	const ctx = { cwd: "/tmp/project", ui: { notify }, sessionManager: { getBranch: () => entries } };
	const run = async (args: unknown = []) => {
		await handler!(args, ctx);
		return notify.mock.calls.at(-1)?.[0] as string;
	};
	return { run, notify };
}

function expectNoDiagnostics(output: string) {
	expect(output).not.toContain("Memory view:");
	expect(output).not.toContain("Memory diff:");
	expect(output).not.toContain("recorded / ");
	expect(output).not.toContain("dropped");
	expect(output).not.toContain(" visible +");
	expect(output).not.toContain("tokens");
	expect(output).not.toContain("Observation pool");
	expect(output).not.toContain("Reflection pool");
	expect(output).not.toContain("Full fold pool");
	expect(output).not.toContain("only in full");
}

describe("V3 /om-view", () => {
	it("renders no-memory visible output as content-only sections", async () => {
		const output = await setup([]).run();

		expect(output).toBe([
			"── Reflections ──",
			"No visible reflections.",
			"",
			"── Observations ──",
			"No visible observations.",
		].join("\n"));
		expect(output).not.toContain("committed");
		expect(output).not.toContain("pending");
		expectNoDiagnostics(output);
	});

	it("default view renders latest visible om.folded memory content only", async () => {
		const obs = observation("aaaaaaaaaaaa");
		const ref = reflection("eeeeeeeeeeee", ["aaaaaaaaaaaa"]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			observationsRecordedEntry("om-obs", { observations: [observation("bbbbbbbbbbbb")], coversUpToId: "raw-1" }),
			compactionEntry("cmp", { firstKeptEntryId: "raw-1", details: memoryDetails({ observations: [obs], reflections: [ref] }) }),
		];

		const output = await setup(entries).run();

		expect(output).toContain("── Reflections ──");
		expect(output).toContain("[eeeeeeeeeeee] Reflection eeeeeeeeeeee");
		expect(output).toContain("── Observations ──");
		expect(output).toContain("[aaaaaaaaaaaa]");
		expect(output).not.toContain("bbbbbbbbbbbb");
		expectNoDiagnostics(output);
	});

	it("full view folds recorded V3 memory and excludes dropped observations", async () => {
		const obsA = observation("aaaaaaaaaaaa", { content: "Dropped observation content" });
		const obsB = observation("bbbbbbbbbbbb", { content: "Kept observation content" });
		const ref = reflection("eeeeeeeeeeee", ["bbbbbbbbbbbb"]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			oldV2ObservationEntry("v2-obs"),
			compactionEntry("cmp-v2", { firstKeptEntryId: "raw-1", details: oldV2CompactionDetails() }),
			observationsRecordedEntry("om-obs", { observations: [obsA, obsB], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "om-obs" }),
			observationsDroppedEntry("om-drop", { observationIds: ["aaaaaaaaaaaa"], coversUpToId: "om-ref" }),
		];

		const output = await setup(entries).run(["full"]);

		expect(output).toContain("── Reflections ──");
		expect(output).toContain("[eeeeeeeeeeee] Reflection eeeeeeeeeeee");
		expect(output).toContain("── Observations ──");
		expect(output).toContain("[bbbbbbbbbbbb]");
		expect(output).toContain("Kept observation content");
		expect(output).not.toContain("[aaaaaaaaaaaa]");
		expect(output).not.toContain("Dropped observation content");
		expect(output).not.toContain("v2-obs");
		expect(output).not.toContain("observational-memory");
		expectNoDiagnostics(output);
	});

	it("full view renders recorded empty states when ledger has no active memory", async () => {
		const output = await setup([]).run(["full"]);

		expect(output).toBe([
			"── Reflections ──",
			"No recorded reflections.",
			"",
			"── Observations ──",
			"No recorded observations.",
		].join("\n"));
		expectNoDiagnostics(output);
	});

	it("diff view directs diagnostics to /om-status instead of rendering diff lists", async () => {
		const obsA = observation("aaaaaaaaaaaa");
		const obsB = observation("bbbbbbbbbbbb");
		const ref = reflection("eeeeeeeeeeee", ["bbbbbbbbbbbb"]);
		const entries = [
			textCustomMessage("raw-1", "aaaa"),
			compactionEntry("cmp", { firstKeptEntryId: "raw-1", details: memoryDetails({ observations: [obsA], reflections: [] }) }),
			observationsRecordedEntry("om-obs", { observations: [obsA, obsB], coversUpToId: "raw-1" }),
			reflectionsRecordedEntry("om-ref", { reflections: [ref], coversUpToId: "om-obs" }),
		];

		const output = await setup(entries).run(["diff"]);

		expect(output).toBe("Use /om-status to see recorded-vs-visible drift.");
		expect(output).not.toContain("Observations only in full");
		expect(output).not.toContain("Reflections only in full");
		expect(output).not.toContain("[bbbbbbbbbbbb]");
		expect(output).not.toContain("[eeeeeeeeeeee]");
	});
});
