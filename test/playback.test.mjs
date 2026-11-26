/** Tests for the pure time and track helpers in src/playback.ts. Run with: npm test */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { test } from "node:test";

execSync("npx tsc src/playback.ts --outDir test/out-playback --module es2022 --target es2022 --moduleResolution bundler --skipLibCheck --types node", { stdio: "inherit" });
const { estimatePosition, clampPosition, formatTime, stepTrack, trackLabel, decideResume, navigateCommand } = await import("./out-playback/playback.js");

const item = { id: "x", title: "Film", artworkId: "x", positionSeconds: 100, durationSeconds: 110, audioIndex: 1, subtitleIndex: -1, reportedAt: 0 };

test("while playing, the estimate adds the time since the last report", () => {
	assert.equal(estimatePosition(item, false, 5000), 105);
});
test("while paused, the estimate stays put", () => {
	assert.equal(estimatePosition(item, true, 5000), 100);
});
test("the estimate never runs past the end", () => {
	assert.equal(estimatePosition(item, false, 60_000), 110);
});
test("seek targets are kept inside the film", () => {
	assert.equal(clampPosition(-30, item), 0);
	assert.equal(clampPosition(500, item), 110);
});
test("times read like a player's clock", () => {
	assert.equal(formatTime(0), "0:00");
	assert.equal(formatTime(75), "1:15");
	assert.equal(formatTime(3725), "1:02:05");
});

const subs = [{ index: -1, label: "Off" }, { index: 3, label: "English" }, { index: 4, label: "French" }];
test("stepping through tracks wraps round both ways", () => {
	assert.equal(stepTrack(subs, -1, 1).label, "English");
	assert.equal(stepTrack(subs, 4, 1).label, "Off");
	assert.equal(stepTrack(subs, -1, -1).label, "French");
	assert.equal(stepTrack(subs, 3, 4).label, "French"); // a fast spin: English +4 = French, Off, English, French
});
test("an unknown current track starts from the top of the list", () => {
	assert.equal(stepTrack(subs, 99, 1).label, "English");
});
test("track labels fall back sensibly", () => {
	assert.equal(trackLabel(subs, 3), "English");
	assert.equal(trackLabel(subs, -1), "Off");
	assert.equal(trackLabel([], 7), "Track 7");
});

const cw = [{ id: "film1", positionSeconds: 3600 }, { id: "ep7", positionSeconds: 10 }];
test("Resume after Stop plays the top of Continue Watching from where it was left", () => {
	assert.deepEqual(decideResume({ item: null, paused: false }, cw), { kind: "play", itemId: "film1", startSeconds: 3600 });
});
test("Resume while paused just carries on", () => {
	assert.deepEqual(decideResume({ item: {}, paused: true }, cw), { kind: "unpause" });
});
test("Resume while already playing leaves it alone", () => {
	assert.deepEqual(decideResume({ item: {}, paused: false }, cw), { kind: "none" });
});
test("Resume with nothing to continue says so", () => {
	assert.deepEqual(decideResume({ item: null, paused: false }, []), { kind: "empty" });
});

test("Navigate: a plain turn moves left / right, clockwise is right", () => {
	assert.equal(navigateCommand(1, false), "MoveRight");
	assert.equal(navigateCommand(-2, false), "MoveLeft");
});
test("Navigate: turning while holding the dial moves up / down, clockwise is down", () => {
	assert.equal(navigateCommand(1, true), "MoveDown");
	assert.equal(navigateCommand(-1, true), "MoveUp");
});
test("Navigate: with the axis set to vertical, holding swaps to left / right", () => {
	assert.equal(navigateCommand(1, false, "vertical"), "MoveDown");
	assert.equal(navigateCommand(1, true, "vertical"), "MoveRight");
});
