import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.js";
import {
	fullProjection,
	observationToSummaryLine,
	reflectionToSummaryLine,
	visibleProjection,
	type Entry,
	type Projection,
} from "../session-ledger/index.js";

function firstArg(args: unknown): string | undefined {
	if (Array.isArray(args)) return typeof args[0] === "string" ? args[0] : undefined;
	if (typeof args === "string") return args.trim().split(/\s+/)[0];
	if (args && typeof args === "object" && "mode" in args) {
		const mode = (args as { mode?: unknown }).mode;
		return typeof mode === "string" ? mode : undefined;
	}
	return undefined;
}

function renderList<T>(items: T[], render: (item: T) => string, empty: string): string {
	return items.length > 0 ? items.map(render).join("\n") : empty;
}

function renderContentOnlyProjection(projection: Projection, emptyScope: "visible" | "recorded"): string {
	return [
		"── Reflections ──",
		renderList(projection.reflections, reflectionToSummaryLine, `No ${emptyScope} reflections.`),
		"",
		"── Observations ──",
		renderList(projection.observations, observationToSummaryLine, `No ${emptyScope} observations.`),
	].join("\n");
}

export function registerViewCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand("om-view", {
		description: "Print observational memory content (visible by default, full for recorded memory)",
		handler: async (args, ctx) => {
			runtime.ensureConfig(ctx.cwd);
			const entries = ctx.sessionManager.getBranch() as Entry[];
			const mode = firstArg(args) ?? "visible";

			if (mode === "full") {
				ctx.ui.notify(renderContentOnlyProjection(fullProjection(entries), "recorded"), "info");
				return;
			}

			if (mode === "diff") {
				ctx.ui.notify("Use /om-status to see recorded-vs-visible drift.", "info");
				return;
			}

			ctx.ui.notify(renderContentOnlyProjection(visibleProjection(entries), "visible"), "info");
		},
	});
}
