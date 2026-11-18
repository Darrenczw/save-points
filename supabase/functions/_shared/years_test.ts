// deno test supabase/functions/_shared/years_test.ts
// Cases use real trophy counts and dates from the 18 Nov 2026 PSN spike (PRD §7.5 examples).
import { assertEquals, assertAlmostEquals } from "jsr:@std/assert@1";
import { cleanName, hoursFromISO, labelYears, mergePlayed, splitHours, type PlayedTitle } from "./years.ts";

const TODAY = "2026-11-18";
const summary = (e: ReturnType<typeof labelYears>) => e.map((x) => `${x.year} ${x.label}${x.isMain ? " ★" : ""}`).join(" · ");

Deno.test("main year comes from trophies, with brief visits around it (Cyberpunk)", () => {
  assertEquals(summary(labelYears("2021-05-16", "2026-10-09", { 2021: 1, 2024: 34 }, TODAY)),
    "2021 Brief visit · 2024 Played ★ · 2026 Brief visit");
});

Deno.test("next-year play is Continued (Witcher 3)", () => {
  assertEquals(summary(labelYears("2019-11-22", "2026-09-29", { 2019: 6, 2020: 31, 2022: 1 }, TODAY)),
    "2019 Played · 2020 Continued ★ · 2022 Brief visit · 2026 Brief visit");
});

Deno.test("a gap then 5+ trophies is a Replay (Spider-Man)", () => {
  assertEquals(summary(labelYears("2018-09-11", "2022-08-22", { 2018: 23, 2019: 2, 2021: 35, 2022: 1 }, TODAY)),
    "2018 Played · 2019 Continued · 2021 Replayed ★ · 2022 Brief visit");
});

Deno.test("no trophies: main year holds most of the date span (FIFA 22)", () => {
  assertEquals(summary(labelYears("2021-11-26", "2022-10-01", {}, TODAY)), "2021 Continued · 2022 Played ★");
});

Deno.test("now playing is never a brief visit (NBA 2K26)", () => {
  assertEquals(summary(labelYears("2025-10-29", "2026-11-17", { 2025: 3 }, TODAY)), "2025 Played ★ · 2026 Continued");
});

Deno.test("one-year game is simply Played ★ (Days Gone)", () => {
  assertEquals(summary(labelYears("2020-04-14", "2020-05-01", { 2020: 19 }, TODAY)), "2020 Played ★");
});

Deno.test("hour split adds up exactly to the total", () => {
  const e = labelYears("2019-11-22", "2026-09-29", { 2019: 6, 2020: 31, 2022: 1 }, TODAY);
  const split = splitHours(142.5, e);
  assertAlmostEquals([...split.values()].reduce((a, b) => a + b, 0), 142.5, 1e-9);
  assertEquals(split.get(2020)! > split.get(2019)!, true);
});

Deno.test("ISO durations", () => {
  assertAlmostEquals(hoursFromISO("PT68H48M"), 68.8, 1e-9);
  assertAlmostEquals(hoursFromISO("P1DT2H30M"), 26.5, 1e-9);
  assertEquals(hoursFromISO("PT0S"), 0);
  assertEquals(hoursFromISO("garbage"), 0);
});

Deno.test("name clean-up", () => {
  assertEquals(cleanName("DEATH STRANDING™"), "DEATH STRANDING");
  assertEquals(cleanName("Classic_MEGAMAN X COMMAND MISSION [PS2 emulation]"), "MEGAMAN X COMMAND MISSION");
  assertEquals(cleanName("It Takes Two PS4™ & PS5™"), "It Takes Two");
  assertEquals(cleanName("Grand Theft Auto V (PlayStation®5)"), "Grand Theft Auto V");
});

Deno.test("merge PS4 + PS5 copies, drop apps", () => {
  const t = (id: string, cat: string, dur: string, f: string, l: string): PlayedTitle => ({
    titleId: id, name: "The Witcher 3: Wild Hunt — Remastered", category: cat, playDuration: dur,
    firstPlayedDateTime: f + "T10:00:00Z", lastPlayedDateTime: l + "T10:00:00Z", concept: { id: 1 },
  });
  const merged = mergePlayed([
    t("CUSA0001_00", "ps4_game", "PT139H41M28S", "2019-11-22", "2020-05-03"),
    t("PPSA0001_00", "ps5_native_game", "PT2H47M58S", "2022-12-14", "2026-09-29"),
    { ...t("CUSA9999_00", "ps5_native_media_app", "PT4H", "2021-01-01", "2021-01-02"), concept: { id: 2 } },
  ]);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].platforms, ["PS4", "PS5"]);
  assertEquals(merged[0].first, "2019-11-22");
  assertEquals(merged[0].last, "2026-09-29");
  assertAlmostEquals(merged[0].hours, 142.49, 0.01);
});
