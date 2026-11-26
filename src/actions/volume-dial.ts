import { action, DialAction, DialDownEvent, DialRotateEvent, TouchTapEvent } from "@elgato/streamdeck";

import { STATUS_TEXT } from "../hub";
import { BaseSettings, canPlayback, Instance, JellyfinAction } from "./base";
import { COLORS, GLYPHS, shorten } from "./look";

type Settings = BaseSettings & { step?: number };
type State = { volume?: number; until?: number; sendTimer?: ReturnType<typeof setTimeout>; muted?: { value: boolean; until: number } };

const SEND_EVERY_MS = 120; // at most one volume command per 120ms while you spin the dial
const TRUST_LOCAL_MS = 4000; // the server's report lags; trust what you just dialled for a bit

/** Turn: volume. Press: play / pause. Tap the strip: mute. */
@action({ UUID: "com.jere.jellyfin-remote.volume" })
export class VolumeDial extends JellyfinAction<Settings> {
	protected readonly need = "volume" as const;

	override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		const st = inst.state as State;
		const { player } = this.resolve(inst);
		const step = Math.max(1, Math.min(20, Number(inst.settings.step) || 5));
		const known = currentVolume(st, player?.volume ?? null);

		if (player?.canSetVolume && known !== null) {
			// Work out the new level here, show it straight away, and send it shortly after.
			st.volume = Math.max(0, Math.min(100, known + ev.payload.ticks * step));
			st.until = Date.now() + TRUST_LOCAL_MS;
			await this.render(inst);
			this.queueSend(inst);
		} else {
			// Level unknown (some players only report it after it changes): nudge with the player's own steps.
			await this.run(
				inst,
				(p) => p.canStepVolume,
				async (c, p) => {
					for (let i = 0; i < Math.min(Math.abs(ev.payload.ticks), 5); i++) await c.stepVolume(p.id, ev.payload.ticks > 0);
				},
			);
		}
	}

	override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (inst) await this.run(inst, canPlayback, (c, p) => c.playPause(p.id));
	}

	override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		const { player } = this.resolve(inst);
		const ok = await this.run(inst, (p) => p.commands.includes("ToggleMute"), (c, p) => c.toggleMute(p.id));
		if (ok && player) {
			(inst.state as State).muted = { value: !player.muted, until: Date.now() + TRUST_LOCAL_MS };
			await this.render(inst);
		}
	}

	/**
	 * Spinning the dial fires lots of events. Rather than one request per click, queue a single
	 * send; when it fires, it uses whatever the latest level is. This is called throttling.
	 */
	private queueSend(inst: Instance<Settings>): void {
		const st = inst.state as State;
		if (st.sendTimer) return;
		st.sendTimer = setTimeout(async () => {
			st.sendTimer = undefined;
			const level = st.volume;
			if (level === undefined) return;
			await this.run(inst, (p) => p.canSetVolume, (c, p) => c.setVolume(p.id, level));
		}, SEND_EVERY_MS);
	}

	protected async render(inst: Instance<Settings>): Promise<void> {
		const dial = inst.action as DialAction<Settings>;
		const st = inst.state as State;
		const { player, status } = this.resolve(inst);
		if (!player) {
			await dial.setFeedback({
				glyph: GLYPHS.tv,
				name: "Jellyfin",
				value: { value: STATUS_TEXT[status === "ok" ? "noPlayer" : status], color: COLORS.hint },
				indicator: { value: 0, enabled: false },
			});
			return;
		}
		const volume = currentVolume(st, player.volume);
		const muted = st.muted && Date.now() < st.muted.until ? st.muted.value : player.muted;
		const known = volume !== null;
		await dial.setFeedback({
			glyph: muted ? GLYPHS.tvOff : player.paused ? GLYPHS.paused : GLYPHS.tv,
			name: player.paused ? "Paused" : shorten(player.name, 16),
			value: muted
				? { value: "Muted", color: COLORS.muted }
				: { value: known ? `${volume}%` : "Ready", color: known ? COLORS.text : COLORS.hint },
			indicator: { value: volume ?? 0, enabled: known && !muted },
		});
	}
}

function currentVolume(st: State, reported: number | null): number | null {
	return st.volume !== undefined && Date.now() < (st.until ?? 0) ? st.volume : reported;
}
