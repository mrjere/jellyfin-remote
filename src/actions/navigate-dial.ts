import { action, DialAction, DialDownEvent, DialRotateEvent, DialUpEvent, TouchTapEvent } from "@elgato/streamdeck";

import { STATUS_TEXT } from "../hub";
import { navigateCommand } from "../playback";
import { accepts, BaseSettings, Instance, JellyfinAction } from "./base";
import { COLORS, GLYPHS, shorten } from "./look";

type Settings = BaseSettings & { axis?: "horizontal" | "vertical" };
type State = { held?: boolean; turnedWhileHeld?: boolean };

/**
 * Drive the TV's menus from the sofa, in all four directions.
 * Turn: left / right. Hold the dial down and turn: up / down. Click (press and let go): OK.
 * Tap the strip: back. Hold the strip: home.
 */
@action({ UUID: "com.jere.jellyfin-remote.navigate" })
export class NavigateDial extends JellyfinAction<Settings> {
	protected readonly need = "control" as const;

	override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		if (ev.payload.pressed) (inst.state as State).turnedWhileHeld = true;
		const name = navigateCommand(ev.payload.ticks, ev.payload.pressed, inst.settings.axis);
		// One move per click, capped so a fast spin doesn't send twenty.
		const times = Math.min(Math.abs(ev.payload.ticks), 5);
		await this.run(inst, accepts(name), async (c, p) => {
			for (let i = 0; i < times; i++) await c.command(p.id, name);
		});
	}

	/**
	 * OK fires when you let go, not when you press: pressing is also how you start a
	 * hold-and-turn, and we only know which it was once the dial comes back up.
	 */
	override onDialDown(ev: DialDownEvent<Settings>): void {
		const inst = this.instances.get(ev.action.id);
		if (inst) Object.assign(inst.state, { held: true, turnedWhileHeld: false });
	}

	override async onDialUp(ev: DialUpEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		const st = inst.state as State;
		const wasClick = st.held && !st.turnedWhileHeld;
		Object.assign(st, { held: false, turnedWhileHeld: false });
		if (wasClick) await this.run(inst, accepts("Select"), (c, p) => c.command(p.id, "Select"));
	}

	override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
		const inst = this.instances.get(ev.action.id);
		if (!inst) return;
		const name = ev.payload.hold ? "GoHome" : "Back";
		await this.run(inst, accepts(name), (c, p) => c.command(p.id, name));
	}

	protected async render(inst: Instance<Settings>): Promise<void> {
		const dial = inst.action as DialAction<Settings>;
		const { player, status } = this.resolve(inst);
		await dial.setFeedback({
			glyph: GLYPHS.navigate,
			name: player ? shorten(player.name, 16) : "Jellyfin",
			value: player
				? { value: "Navigate", color: COLORS.text }
				: { value: STATUS_TEXT[status === "ok" ? "noPlayer" : status], color: COLORS.hint },
			indicator: { value: 0, enabled: false },
		});
	}
}
