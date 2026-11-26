import { action, DialAction, DialDownEvent, DialRotateEvent, TouchTapEvent } from "@elgato/streamdeck";

import { hub, STATUS_TEXT } from "../hub";
import { LibraryItem, LibraryList, Player } from "../jellyfin";
import { BaseSettings, Instance, JellyfinAction } from "./base";
import { COLORS, GLYPHS, shorten } from "./look";

type Settings = BaseSettings & { list?: LibraryList };
type State = { list?: LibraryList; selectedId?: string; flash?: { text: string; until: number } };

const LIST_NAMES: Record<LibraryList, string> = { resume: "Continue", nextup: "Next up" };

/**
 * Pick something to watch without touching the TV's menus.
 * Turn: step through Continue Watching. Press: play it on the player, from where you left off.
 * Tap the strip: switch between Continue Watching and Next Up. Hold the strip: play from the start.
 */
@action({ UUID: "com.jere.jellyfin-remote.library" })
export class LibraryDial extends JellyfinAction<Settings> {
	protected readonly need = "control" as const;

	override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		const ctx = inst && (await this.context(inst));
		if (!inst || !ctx || ctx.items.length === 0) return void (await inst?.action.showAlert());
		const at = this.selectedIndex(inst, ctx.items);
		const next = Math.max(0, Math.min(ctx.items.length - 1, at + ev.payload.ticks)); // stops at the ends
		(inst.state as State).selectedId = ctx.items[next].id;
		await this.render(inst);
	}

	override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (inst) await this.playSelected(inst, false);
	}

	override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		if (ev.payload.hold) return void (await this.playSelected(inst, true));
		const st = inst.state as State;
		st.list = this.listOf(inst) === "resume" ? "nextup" : "resume";
		st.selectedId = undefined; // start at the top of the other list
		await this.render(inst);
	}

	private async playSelected(inst: Instance<Settings>, fromStart: boolean): Promise<void> {
		const ctx = await this.context(inst);
		if (!ctx || ctx.items.length === 0) return void (await inst.action.showAlert());
		const item = ctx.items[this.selectedIndex(inst, ctx.items)];
		const start = fromStart ? 0 : item.positionSeconds;
		const ok = await this.run(inst, (p) => p.canPlayPause, (c, p) => c.play(p.id, item.id, start));
		if (ok) {
			hub.forgetLists(); // it'll move to the top of Continue Watching
			const st = inst.state as State;
			st.selectedId = undefined;
			st.flash = { text: fromStart ? "From start" : "Playing", until: Date.now() + 2000 };
			await this.render(inst);
		}
	}

	private listOf(inst: Instance<Settings>): LibraryList {
		return (inst.state as State).list ?? inst.settings.list ?? "resume";
	}

	/** Keep pointing at the same title even if the list reorders; fall back to the top. */
	private selectedIndex(inst: Instance<Settings>, items: LibraryItem[]): number {
		const id = (inst.state as State).selectedId;
		return Math.max(0, items.findIndex((it) => it.id === id));
	}

	/** The player and the chosen list for the user signed in on it. */
	private async context(inst: Instance<Settings>): Promise<{ player: Player; items: LibraryItem[] } | null> {
		const { player } = this.resolve(inst);
		if (!player?.userId || !hub.client) return null;
		try {
			return { player, items: await hub.listFor(player.userId, this.listOf(inst)) };
		} catch {
			return null;
		}
	}

	protected async render(inst: Instance<Settings>): Promise<void> {
		const dial = inst.action as DialAction<Settings>;
		const st = inst.state as State;
		const list = this.listOf(inst);
		const glyph = list === "resume" ? GLYPHS.resume : GLYPHS.nextup;
		const { player, status } = this.resolve(inst);
		const ctx = await this.context(inst);

		if (!player || !ctx) {
			await dial.setFeedback({
				glyph,
				name: LIST_NAMES[list],
				value: { value: player ? "Unavailable" : STATUS_TEXT[status === "ok" ? "noPlayer" : status], color: COLORS.hint },
				indicator: { value: 0, enabled: false },
			});
			return;
		}
		if (ctx.items.length === 0) {
			await dial.setFeedback({
				glyph,
				name: LIST_NAMES[list],
				value: { value: "Empty", color: COLORS.hint },
				indicator: { value: 0, enabled: false },
			});
			return;
		}

		const at = this.selectedIndex(inst, ctx.items);
		const item = ctx.items[at];
		const flashing = st.flash && Date.now() < st.flash.until;
		// Big line: episode code, or how far through a film you are, or "Playing" just after a press.
		const value = flashing ? st.flash!.text : item.episode || (item.percent ? `${item.percent}%` : `${at + 1}/${ctx.items.length}`);
		await dial.setFeedback({
			glyph,
			name: shorten(item.name, 17),
			value: { value, color: COLORS.text },
			indicator: { value: item.percent, enabled: list === "resume" && item.percent > 0 },
		});
	}
}
