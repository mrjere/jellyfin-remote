import { action, DialAction, DialDownEvent, DialRotateEvent, TouchTapEvent } from "@elgato/streamdeck";

import { hub, STATUS_TEXT } from "../hub";
import { Player, Tracks } from "../jellyfin";
import { stepTrack, trackLabel } from "../playback";
import { accepts, BaseSettings, Instance, JellyfinAction } from "./base";
import { COLORS, GLYPHS, shorten } from "./look";

type Settings = BaseSettings;
type State = {
	sub?: { index: number; until: number };
	audio?: { index: number; label: string; until: number };
	lastSub?: number;
	sendTimer?: ReturnType<typeof setTimeout>;
};

const TRUST_LOCAL_MS = 4000;
const SEND_AFTER_MS = 400; // wait until you stop turning, so the player doesn't flick through every track

/**
 * Turn: step through subtitles (including Off). Press or hold the strip: next audio track.
 * Tap the strip: subtitles off / back on.
 */
@action({ UUID: "com.jere.jellyfin-remote.tracks" })
export class TracksDial extends JellyfinAction<Settings> {
	protected readonly need = "control" as const;

	override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		const ctx = inst && (await this.context(inst));
		if (!inst || !ctx || !ctx.player.commands.includes("SetSubtitleStreamIndex")) return void (await inst?.action.showAlert());
		const next = stepTrack(ctx.tracks.subtitles, this.currentSub(inst, ctx.player), ev.payload.ticks);
		if (!next) return void (await inst.action.showAlert());
		this.setSub(inst, next.index);
		await this.render(inst);
	}

	override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (inst) await this.nextAudio(inst);
	}

	override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		if (ev.payload.hold) return void (await this.nextAudio(inst));

		const ctx = await this.context(inst);
		if (!ctx || !ctx.player.commands.includes("SetSubtitleStreamIndex")) return void (await inst.action.showAlert());
		const st = inst.state as State;
		const current = this.currentSub(inst, ctx.player);
		if (current !== -1) {
			st.lastSub = current; // remember it so the next tap brings it back
			this.setSub(inst, -1);
		} else {
			const firstReal = ctx.tracks.subtitles.find((t) => t.index !== -1)?.index;
			const back = st.lastSub ?? firstReal;
			if (back === undefined) return void (await inst.action.showAlert());
			this.setSub(inst, back);
		}
		await this.render(inst);
	}

	private async nextAudio(inst: Instance<Settings>): Promise<void> {
		const ctx = await this.context(inst);
		if (!ctx || ctx.tracks.audio.length < 2) return void (await inst.action.showAlert());
		const st = inst.state as State;
		const current = st.audio && Date.now() < st.audio.until ? st.audio.index : ctx.player.item?.audioIndex ?? null;
		const next = stepTrack(ctx.tracks.audio, current, 1)!;
		const ok = await this.run(inst, accepts("SetAudioStreamIndex"), (c, p) => c.setAudioTrack(p.id, next.index));
		if (ok) {
			st.audio = { index: next.index, label: next.label, until: Date.now() + 2500 }; // flash the new track on the strip
			await this.render(inst);
		}
	}

	/** Show the new subtitle straight away; send it once you've stopped turning. */
	private setSub(inst: Instance<Settings>, index: number): void {
		const st = inst.state as State;
		st.sub = { index, until: Date.now() + TRUST_LOCAL_MS };
		clearTimeout(st.sendTimer);
		st.sendTimer = setTimeout(() => {
			void this.run(inst, accepts("SetSubtitleStreamIndex"), (c, p) => c.setSubtitleTrack(p.id, index));
		}, SEND_AFTER_MS);
	}

	private currentSub(inst: Instance<Settings>, player: Player): number {
		const st = inst.state as State;
		if (st.sub && Date.now() < st.sub.until) return st.sub.index;
		return player.item?.subtitleIndex ?? -1;
	}

	/** The player and the tracks of what it's playing (fetched once per film or episode). */
	private async context(inst: Instance<Settings>): Promise<{ player: Player; tracks: Tracks } | null> {
		const { player } = this.resolve(inst);
		if (!player?.item || !hub.client) return null;
		try {
			return { player, tracks: await hub.tracksFor(player.item.id, player.userId) };
		} catch {
			return null;
		}
	}

	protected async render(inst: Instance<Settings>): Promise<void> {
		const dial = inst.action as DialAction<Settings>;
		const st = inst.state as State;
		const { player, status } = this.resolve(inst);
		const ctx = await this.context(inst);
		if (!player || !ctx) {
			await dial.setFeedback({
				glyph: GLYPHS.subtitles,
				name: player ? shorten(player.name, 16) : "Jellyfin",
				value: { value: player ? "Nothing on" : STATUS_TEXT[status === "ok" ? "noPlayer" : status], color: COLORS.hint },
				indicator: { value: 0, enabled: false },
			});
			return;
		}
		if (st.audio && Date.now() < st.audio.until) {
			await dial.setFeedback({
				glyph: GLYPHS.audio,
				name: "Audio",
				value: { value: shorten(st.audio.label, 9), color: COLORS.text },
				indicator: { value: 0, enabled: false },
			});
			return;
		}
		const sub = this.currentSub(inst, player);
		await dial.setFeedback({
			glyph: GLYPHS.subtitles,
			name: "Subtitles",
			value: { value: shorten(trackLabel(ctx.tracks.subtitles, sub), 9), color: sub === -1 ? COLORS.hint : COLORS.text },
			indicator: { value: 0, enabled: false },
		});
	}
}
