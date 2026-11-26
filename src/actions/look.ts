/** Colours and touch strip symbols, matching the dial icons (light blue on dark slate). */
export const COLORS = { text: "#EAF3FC", hint: "#8FB0D4", muted: "#F4A3A3" };

/** Symbols for the touch strip's "glyph" slot (see layouts/panel.json). */
export const GLYPHS = {
	tv: "imgs/layouts/tv.png",
	tvOff: "imgs/layouts/tv-off.png",
	paused: "imgs/layouts/paused.png",
	scrub: "imgs/layouts/scrub.png",
	subtitles: "imgs/layouts/subtitles.png",
	audio: "imgs/layouts/audio.png",
	navigate: "imgs/layouts/navigate.png",
	resume: "imgs/layouts/resume.png",
	nextup: "imgs/layouts/nextup.png",
};

export function shorten(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
