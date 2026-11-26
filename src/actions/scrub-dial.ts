import { action, DialAction, DialDownEvent, DialRotateEvent, TouchTapEvent } from "@elgato/streamdeck";

import { STATUS_TEXT } from "../hub";
import { clampPosition, estimatePosition, formatTime } from "../playback";
import { BaseSettings, canPlayback, hasItem, Instance, JellyfinAction } from "./base";
import { COLORS, GLYPHS, shorten } from "./look";

type Settings = BaseSettings & { step?: number };
type State = { pos?: number; until?: number; sendTimer?: ReturnType<typeof setTimeout>; paused?: { value: boolean; until: number } };

const SEND_EVERY_MS = 250;
const TRUST_LOCAL_MS = 3000;
const TAP_BACK = 10; // seconds: tap the left half of the strip
const TAP_FORWARD = 30; // seconds: tap the right half

/**
 * Turn: seek through the film. Press: play / pause.
 * Tap the strip: left half back 10s, right half forward 30s. Hold the strip: stop.
 */
@action({ UUID: "com.jere.jellyfin-remote.scrub" })
export class ScrubDial extends JellyfinAction<Settings> {
	protected readonly need = "control" as const;

	override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		const { player } = this.resolve(inst);
		if (!player?.item || !player.canPlayPause) return void (await inst.action.showAlert());
		const st = inst.state as State;
		const step = Math.max(1, Math.min(120, Number(inst.settings.step) || 10));
		st.pos = clampPosition(this.position(inst) + ev.payload.ticks * step, player.item);
		st.until = Date.now() + TRUST_LOCAL_MS;
		await this.render(inst);
		this.queueSeek(inst);
	}

	override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		const { player } = this.resolve(inst);
		if (await this.run(inst, canPlayback, (c, p) => c.playPause(p.id))) {
			(inst.state as State).paused = { value: !player?.paused, until: Date.now() + TRUST_LOCAL_MS };
			await this.render(inst);
		}
	}

	override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		if (ev.payload.hold) {
			await this.run(inst, canPlayback, (c, p) => c.playing(p.id, "Stop"));
			return;
		}
		// The strip is 200px wide per dial: the tap position says which half you touched.
		const jump = ev.payload.tapPos[0] < 100 ? -TAP_BACK : TAP_FORWARD;
		const { player } = this.resolve(inst);
		if (!player?.item) return void (await inst.action.showAlert());
		const st = inst.state as State;
		st.pos = clampPosition(this.position(inst) + jump, player.item);
		st.until = Date.now() + TRUST_LOCAL_MS;
		await this.render(inst);
		const target = st.pos;
		await this.run(inst, hasItem, (c, p) => c.seek(p.id, target));
	}

	/** Where we think playback is: what you just dialled, else the server's report plus time elapsed. */
	private position(inst: Instance<Settings>): number {
		const st = inst.state as State;
		if (st.pos !== undefined && Date.now() < (st.until ?? 0)) return st.pos;
		const { player } = this.resolve(inst);
		return player?.item ? estimatePosition(player.item, this.isPaused(inst)) : 0;
	}

	private isPaused(inst: Instance<Settings>): boolean {
		const st = inst.state as State;
		if (st.paused && Date.now() < st.paused.until) return st.paused.value;
		return !!this.resolve(inst).player?.paused;
	}

	/** Like the volume dial: spin freely, and send only the latest target a few times a second. */
	private queueSeek(inst: Instance<Settings>): void {
		const st = inst.state as State;
		if (st.sendTimer) return;
		st.sendTimer = setTimeout(async () => {
			st.sendTimer = undefined;
			const target = st.pos;
			if (target !== undefined) await this.run(inst, hasItem, (c, p) => c.seek(p.id, target));
		}, SEND_EVERY_MS);
	}

	protected async render(inst: Instance<Settings>): Promise<void> {
		const dial = inst.action as DialAction<Settings>;
		const { player, status } = this.resolve(inst);
		const item = player?.item;
		if (!player || !item) {
			await dial.setFeedback({
				glyph: GLYPHS.scrub,
				name: player ? shorten(player.name, 16) : "Jellyfin",
				value: { value: player ? "Nothing on" : STATUS_TEXT[status === "ok" ? "noPlayer" : status], color: COLORS.hint },
				indicator: { value: 0, enabled: false },
			});
			return;
		}
		const pos = this.position(inst);
		const paused = this.isPaused(inst);
		const pct = item.durationSeconds ? (pos / item.durationSeconds) * 100 : 0;
		await dial.setFeedback({
			glyph: paused ? GLYPHS.paused : GLYPHS.scrub,
			name: shorten(item.title, 17),
			value: { value: formatTime(pos), color: COLORS.text },
			indicator: { value: Math.round(pct), enabled: !!item.durationSeconds },
		});
	}
}
