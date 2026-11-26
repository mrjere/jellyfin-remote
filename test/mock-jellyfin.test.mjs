/**
 * Tests the Jellyfin client against a fake Jellyfin server, so you can check the logic
 * without a real server or a Stream Deck. Run with: npm test
 *
 * It compiles src/jellyfin.ts on the fly, starts a tiny HTTP server that pretends to be
 * Jellyfin, and checks that the right player is picked and the right requests are sent.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import http from "node:http";
import { test, after } from "node:test";

execSync(
	"npx tsc src/jellyfin.ts --outDir test/out-client --module es2022 --target es2022 --moduleResolution bundler --skipLibCheck --types node",
	{ stdio: "inherit" },
);
const { JellyfinClient, JellyfinError, pickSession, toPlayer } = await import("./out-client/jellyfin.js");

const KEY = "test-api-key";
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const VOLUME_CMDS = ["SetVolume", "VolumeUp", "VolumeDown", "ToggleMute"];

const SESSIONS = [
	// Something that can't be remote controlled (like your API key's own session): must be ignored.
	{ Id: "api", DeviceId: "api-dev", Client: "Stream Deck", DeviceName: "Stream Deck", LastActivityDate: minutesAgo(0), SupportedCommands: [] },
	// A forgotten browser tab: something paused, 40 minutes ago. This is what was stealing the dial.
	{ Id: "chrome", DeviceId: "chrome-dev", Client: "Jellyfin Web", DeviceName: "Chrome", UserId: "bbbb2222", UserName: "Family", LastActivityDate: minutesAgo(40),
	  SupportsMediaControl: true, SupportedCommands: VOLUME_CMDS, NowPlayingItem: { Name: "Old film" },
	  PlayState: { VolumeLevel: 95, IsPaused: true } },
	// Recently active, nothing playing.
	{ Id: "tv", DeviceId: "tv-dev", Client: "Jellyfin Android TV", DeviceName: "Living Room TV", LastActivityDate: minutesAgo(1),
	  SupportsMediaControl: true, SupportedCommands: VOLUME_CMDS, PlayState: { VolumeLevel: 80 } },
	// The desktop app, actually playing: automatic mode must pick this.
	{ Id: "jmp", DeviceId: "jmp-dev", Client: "Jellyfin Media Player", DeviceName: "DESKTOP-PC", UserId: "aaaa1111", UserName: "Alex", LastActivityDate: minutesAgo(5),
	  SupportsMediaControl: true, SupportedCommands: VOLUME_CMDS, NowPlayingItem: { Name: "Episode 3" },
	  PlayState: { VolumeLevel: 40, IsMuted: false, IsPaused: false } },
	// A phone that's connected but can't take remote volume: listed in the dropdown, greyed out.
	{ Id: "phone", DeviceId: "phone-dev", Client: "Jellyfin Android", DeviceName: "Phone", LastActivityDate: minutesAgo(2),
	  SupportsMediaControl: true, SupportedCommands: ["DisplayMessage"] },
];

// IDs deliberately mixed: with dashes in /Users, without in sessions, as Jellyfin can do.
const ALEX = "aaaa-1111", FAMILY = "bbbb-2222";
const USERS = [{ Id: "bbbb-2222", Name: "Family" }, { Id: "aaaa-1111", Name: "Alex" }];
let currentSessions = SESSIONS;
const RESUME_ITEMS = [
	{ Id: "ep7", Name: "The Heist", Type: "Episode", SeriesName: "Slow Horses", IndexNumber: 4, ParentIndexNumber: 2,
	  UserData: { PlaybackPositionTicks: 15_000_000_000, PlayedPercentage: 41.6 } },
	{ Id: "film1", Name: "Heat", Type: "Movie", UserData: { PlaybackPositionTicks: 36_000_000_000, PlayedPercentage: 35 } },
];
const EPISODE_DETAILS = {
	MediaSources: [{ MediaStreams: [
		{ Type: "Video", Index: 0 },
		{ Type: "Audio", Index: 1, DisplayTitle: "English - Dolby Digital - 5.1 - Default", Language: "eng" },
		{ Type: "Audio", Index: 2, Title: "Japanese", Language: "jpn" },
		{ Type: "Subtitle", Index: 3, DisplayTitle: "English - SRT", Language: "eng" },
		{ Type: "Subtitle", Index: 4, DisplayTitle: "English - SRT", Language: "eng", IsForced: true },
	] }],
};

const requests = [];
const server = http.createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
		if (req.headers.authorization !== `MediaBrowser Token="${KEY}"`) {
			res.writeHead(401).end();
		} else if (req.method === "GET" && req.url.split("?")[0] === "/Sessions") {
			res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(currentSessions));
		} else if (req.method === "GET" && req.url === "/Items/ep1?userId=aaaa1111") {
			res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(EPISODE_DETAILS));
		} else if (req.method === "GET" && req.url.startsWith("/Items/old1?")) {
			res.writeHead(404).end(); // an older server without /Items/{id}?userId=
		} else if (req.method === "GET" && req.url === "/Users/aaaa1111/Items/old1") {
			res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(EPISODE_DETAILS));
		} else if (req.method === "GET" && req.url.startsWith("/Items/series1/Images/Primary")) {
			res.writeHead(200, { "Content-Type": "image/jpeg" }).end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
		} else if (req.method === "GET" && req.url === "/UserItems/Resume?userId=aaaa1111&limit=20&mediaTypes=Video") {
			res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ Items: RESUME_ITEMS }));
		} else if (req.method === "GET" && req.url.startsWith("/UserItems/Resume?userId=olduser")) {
			res.writeHead(404).end(); // an older server
		} else if (req.method === "GET" && req.url === "/Users/olduser/Items/Resume?limit=20&mediaTypes=Video") {
			res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ Items: RESUME_ITEMS }));
		} else if (req.method === "GET" && req.url === "/Shows/NextUp?userId=aaaa1111&limit=20") {
			res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ Items: [RESUME_ITEMS[0]] }));
		} else if (req.method === "GET" && req.url === "/Users") {
			res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(USERS));
		} else if (req.method === "POST" && req.url.startsWith("/Sessions/")) {
			res.writeHead(204).end();
		} else {
			res.writeHead(404).end();
		}
	});
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const last = () => requests[requests.length - 1];

test("picks the player that's actually playing, ignoring uncontrollable sessions", async () => {
	const p = await new JellyfinClient(base, KEY).findPlayer();
	assert.equal(p.id, "jmp");
	assert.equal(p.volume, 40);
	assert.equal(p.canSetVolume, true);
	assert.equal(p.canPlayPause, true);
});

test("pinning a player by DeviceId controls that one, even when something else is playing", async () => {
	const p = await new JellyfinClient(base, KEY).findPlayer("tv-dev");
	assert.equal(p.id, "tv");
});

test("asks the server for recently active sessions only", async () => {
	await new JellyfinClient(base, KEY).findPlayer();
	const get = requests.filter((r) => r.method === "GET").pop();
	assert.equal(get.url, "/Sessions?activeWithinSeconds=3600");
});

test("a playing app beats a paused browser tab, and gets the app's name", async () => {
	const p = await new JellyfinClient(base, KEY).findPlayer();
	assert.equal(p.id, "jmp");
	assert.equal(p.name, "Jellyfin Media Player");
});

test("the dropdown lists every player, marks status, and flags ones without remote volume", async () => {
	const list = await new JellyfinClient(base, KEY).listSessions();
	const byId = Object.fromEntries(list.map((s) => [s.deviceId, s]));
	assert.equal(byId["jmp-dev"].label, "Jellyfin Media Player · DESKTOP-PC · Alex (playing)");
	assert.equal(byId["chrome-dev"].label, "Chrome · Family (paused)");
	assert.equal(byId["phone-dev"].canVolume, false);
	assert.match(byId["phone-dev"].label, /no remote volume/);
	assert.equal(list[list.length - 1].canVolume, false, "unsupported players go to the bottom");
});

test("accepts a server address without http:// and with a trailing slash", async () => {
	const host = base.replace("http://", "") + "/";
	const p = await new JellyfinClient(host, KEY).findPlayer();
	assert.equal(p.id, "jmp");
});

test("SetVolume sends the right body and auth header, with the volume as a string", async () => {
	await new JellyfinClient(base, KEY).setVolume("jmp", 45);
	assert.deepEqual(last(), {
		method: "POST",
		url: "/Sessions/jmp/Command",
		auth: `MediaBrowser Token="${KEY}"`,
		body: { Name: "SetVolume", Arguments: { Volume: "45" } },
	});
});

test("volume is clamped to 0-100", async () => {
	const c = new JellyfinClient(base, KEY);
	await c.setVolume("jmp", 130);
	assert.equal(last().body.Arguments.Volume, "100");
	await c.setVolume("jmp", -5);
	assert.equal(last().body.Arguments.Volume, "0");
});

test("mute, step and play/pause hit the right endpoints", async () => {
	const c = new JellyfinClient(base, KEY);
	await c.toggleMute("jmp");
	assert.equal(last().url, "/Sessions/jmp/Command/ToggleMute");
	await c.stepVolume("jmp", false);
	assert.equal(last().url, "/Sessions/jmp/Command/VolumeDown");
	await c.playPause("jmp");
	assert.equal(last().url, "/Sessions/jmp/Playing/PlayPause");
});

test("a wrong API key is reported as 'unauthorized'", async () => {
	await assert.rejects(new JellyfinClient(base, "wrong").findPlayer(), (e) => e instanceof JellyfinError && e.kind === "unauthorized");
});

test("a server that isn't there is reported as 'unreachable'", async () => {
	await assert.rejects(new JellyfinClient("http://127.0.0.1:1", KEY, 1000).findPlayer(), (e) => e instanceof JellyfinError && e.kind === "unreachable");
});

test("a pinned player that isn't connected gives null, not an error", async () => {
	const p = await new JellyfinClient(base, KEY).findPlayer("no-such-device");
	assert.equal(p, null);
});

// The real-world case: your app is paused, someone else's TV is playing.
const PRIORITY_CASE = [
	{ Id: "jmp", DeviceId: "jmp-dev", Client: "Jellyfin Media Player", DeviceName: "DESKTOP-PC", UserId: "aaaa1111", UserName: "Alex",
	  LastActivityDate: minutesAgo(3), SupportsMediaControl: true, SupportedCommands: VOLUME_CMDS,
	  NowPlayingItem: { Name: "Episode 3" }, PlayState: { VolumeLevel: 40, IsPaused: true } },
	{ Id: "tvpc", DeviceId: "tvpc-dev", Client: "Jellyfin Web", DeviceName: "Chrome", UserId: "bbbb2222", UserName: "Family",
	  LastActivityDate: minutesAgo(0), SupportsMediaControl: true, SupportedCommands: VOLUME_CMDS,
	  NowPlayingItem: { Name: "Cartoon" }, PlayState: { VolumeLevel: 70, IsPaused: false } },
];
const withSessions = async (list, fn) => { currentSessions = list; try { await fn(); } finally { currentSessions = SESSIONS; } };

test("without user priority, someone else's playing TV wins (the bug you saw)", () =>
	withSessions(PRIORITY_CASE, async () => {
		assert.equal((await new JellyfinClient(base, KEY).findPlayer()).id, "tvpc");
	}));

test("with you as a priority user, your paused app beats their playing TV", () =>
	withSessions(PRIORITY_CASE, async () => {
		const p = await new JellyfinClient(base, KEY).findPlayer("", { users: [ALEX] });
		assert.equal(p.id, "jmp");
	}));

test("'ignore other users' never touches their players, even if you have none", () =>
	withSessions([PRIORITY_CASE[1]], async () => {
		const p = await new JellyfinClient(base, KEY).findPlayer("", { users: [ALEX], onlyUsers: true });
		assert.equal(p, null);
	}));

test("priority without 'ignore' falls back to other users when you have nothing", () =>
	withSessions([PRIORITY_CASE[1]], async () => {
		const p = await new JellyfinClient(base, KEY).findPlayer("", { users: [ALEX] });
		assert.equal(p.id, "tvpc");
	}));

test("pinning a player beats the user rules", () =>
	withSessions(PRIORITY_CASE, async () => {
		const p = await new JellyfinClient(base, KEY).findPlayer("tvpc-dev", { users: [ALEX], onlyUsers: true });
		assert.equal(p.id, "tvpc");
	}));

test("lists the server's users, sorted by name", async () => {
	const users = await new JellyfinClient(base, KEY).listUsers();
	assert.deepEqual(users.map((u) => u.name), ["Alex", "Family"]);
	assert.equal(users.find((u) => u.name === "Alex").id, ALEX);
});

// ----- v2.0: the remote-control side -------------------------------------------------

test("seek sends the position in ticks (1 second = 10,000,000)", async () => {
	await new JellyfinClient(base, KEY).seek("jmp", 123.45);
	assert.equal(last().url, "/Sessions/jmp/Playing/Seek?seekPositionTicks=1234500000");
	await new JellyfinClient(base, KEY).seek("jmp", -5);
	assert.equal(last().url, "/Sessions/jmp/Playing/Seek?seekPositionTicks=0", "never seeks before the start");
});

test("stop, next and previous use the Playing endpoints", async () => {
	const c = new JellyfinClient(base, KEY);
	await c.playing("jmp", "Stop");
	assert.equal(last().url, "/Sessions/jmp/Playing/Stop");
	await c.playing("jmp", "NextTrack");
	assert.equal(last().url, "/Sessions/jmp/Playing/NextTrack");
	await c.playing("jmp", "PreviousTrack");
	assert.equal(last().url, "/Sessions/jmp/Playing/PreviousTrack");
});

test("subtitle and audio tracks are set by index, as strings", async () => {
	const c = new JellyfinClient(base, KEY);
	await c.setSubtitleTrack("jmp", -1);
	assert.deepEqual(last().body, { Name: "SetSubtitleStreamIndex", Arguments: { Index: "-1" } });
	await c.setAudioTrack("jmp", 2);
	assert.deepEqual(last().body, { Name: "SetAudioStreamIndex", Arguments: { Index: "2" } });
});

test("navigation buttons are general commands with no arguments", async () => {
	await new JellyfinClient(base, KEY).command("jmp", "MoveUp");
	assert.equal(last().url, "/Sessions/jmp/Command/MoveUp");
	assert.equal(last().body, null);
});

test("tracks: subtitles get an Off entry, labels are short, forced subs are marked", async () => {
	const t = await new JellyfinClient(base, KEY).getTracks("ep1", "aaaa1111");
	assert.deepEqual(t.audio, [{ index: 1, label: "English" }, { index: 2, label: "Japanese" }]);
	assert.deepEqual(t.subtitles.map((s) => s.label), ["Off", "English", "English (forced)"]);
	assert.equal(t.subtitles[0].index, -1);
});

test("tracks fall back to the older /Users/{id}/Items/{id} address", async () => {
	const t = await new JellyfinClient(base, KEY).getTracks("old1", "aaaa1111");
	assert.equal(t.audio.length, 2);
});

test("artwork comes back as a data URL the key can show, or null if there's none", async () => {
	const c = new JellyfinClient(base, KEY);
	assert.equal(await c.getArtwork("series1"), "data:image/jpeg;base64,/9j/2Q==");
	assert.equal(await c.getArtwork("missing"), null);
});

test("episodes are titled S1E3 and use the series poster", () => {
	const p = toPlayer({
		Id: "s", DeviceId: "d", SupportsMediaControl: true,
		NowPlayingItem: { Id: "ep1", Name: "Pilot", Type: "Episode", SeriesId: "series1", IndexNumber: 3, ParentIndexNumber: 1, RunTimeTicks: 27_000_000_000 },
		PlayState: { PositionTicks: 600_000_000, SubtitleStreamIndex: 3 },
	}, 1000);
	assert.equal(p.item.title, "S1E3 · Pilot");
	assert.equal(p.item.artworkId, "series1");
	assert.equal(p.item.positionSeconds, 60);
	assert.equal(p.item.durationSeconds, 2700);
	assert.equal(p.item.subtitleIndex, 3);
});

test("the volume dial only picks players with remote volume; other controls take any controllable one", () => {
	const tvOnlyPlayback = [{ Id: "tv", DeviceId: "tv", SupportsMediaControl: true, SupportedCommands: ["MoveUp"], NowPlayingItem: { Id: "x" } }];
	assert.equal(pickSession(tvOnlyPlayback, "", {}, "volume"), null);
	assert.equal(pickSession(tvOnlyPlayback, "", {}, "control").Id, "tv");
});

// ----- v2.1: continue watching and play --------------------------------------------

test("Continue Watching: episodes show the series and S2E4, films their name and how far through", async () => {
	const items = await new JellyfinClient(base, KEY).getList("aaaa1111", "resume");
	assert.deepEqual(items[0], { id: "ep7", name: "Slow Horses", episode: "S2E4", positionSeconds: 1500, percent: 42 });
	assert.deepEqual(items[1], { id: "film1", name: "Heat", episode: "", positionSeconds: 3600, percent: 35 });
});

test("Continue Watching falls back to the older /Users/{id}/Items/Resume address", async () => {
	const items = await new JellyfinClient(base, KEY).getList("olduser", "resume");
	assert.equal(items.length, 2);
});

test("Next Up uses /Shows/NextUp for the same user", async () => {
	const items = await new JellyfinClient(base, KEY).getList("aaaa1111", "nextup");
	assert.equal(items[0].id, "ep7");
});

test("play tells the player to start an item at an exact position", async () => {
	await new JellyfinClient(base, KEY).play("tv", "film1", 3600);
	assert.equal(last().method, "POST");
	assert.equal(last().url, "/Sessions/tv/Playing?playCommand=PlayNow&itemIds=film1&startPositionTicks=36000000000");
});
