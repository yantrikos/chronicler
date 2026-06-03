// Arc clustering + status derivation.
// Run: npx tsx tests/arcs.test.ts

import {
  clusterArcs,
  deriveStatus,
  summarizeActiveArcs,
} from "../src/lib/arcs/cluster";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

function main(): void {
  console.log("--- arc clustering test ---");

  const NOW = new Date("2026-06-02T12:00:00Z");
  const today = "2026-06-02T08:00:00Z";       // ~4h ago → active
  const recent = "2026-06-01T08:00:00Z";       // ~28h ago → paused
  const week = "2026-05-28T08:00:00Z";         // ~5d ago → paused
  const stale = "2026-05-12T08:00:00Z";        // ~21d ago → abandoned

  // ---- pure deriveStatus ----
  check(deriveStatus(today, NOW) === "active", "today → active");
  check(deriveStatus(recent, NOW) === "paused", "1-7 days → paused");
  check(deriveStatus(week, NOW) === "paused", "<14 days → paused");
  check(deriveStatus(stale, NOW) === "abandoned", "21 days → abandoned");
  check(
    deriveStatus("not-a-date", NOW) === "abandoned",
    "garbage timestamp → abandoned"
  );

  // ---- clusterArcs with explicit entities ----
  {
    const arcs = clusterArcs(
      [
        {
          rid: "m1",
          text: "Mara forged a promise about the salt coast.",
          importance: 0.8,
          touched_at: today,
          entities: ["Mara", "salt_coast"],
        },
        {
          rid: "m2",
          text: "Mara visited the harbor with the user.",
          importance: 0.6,
          touched_at: recent,
          entities: ["Mara", "harbor"],
        },
        {
          rid: "m3",
          text: "The salt coast suffered a storm.",
          importance: 0.7,
          touched_at: week,
          entities: ["salt_coast"],
        },
        {
          rid: "m4",
          text: "An unrelated character Cass appears.",
          importance: 0.5,
          touched_at: stale,
          entities: ["Cass"],
        },
      ],
      NOW
    );

    // Three buckets: Mara, salt_coast, harbor, Cass
    check(arcs.length === 4, `four entity arcs (got ${arcs.length})`);

    const mara = arcs.find((a) => a.primary_entity === "Mara");
    check(!!mara, "Mara arc exists");
    check(
      mara!.members.length === 2,
      `Mara has 2 members (got ${mara!.members.length})`
    );
    check(mara!.status === "active", "Mara is active (most-recent member is today)");
    check(
      mara!.members[0].rid === "m1",
      "Mara members sorted most-recent first"
    );

    const salt = arcs.find((a) => a.primary_entity === "salt_coast");
    check(salt!.status === "active", "salt_coast active (m1 was today)");
    check(salt!.members.length === 2, "salt_coast has 2 members");

    const cass = arcs.find((a) => a.primary_entity === "Cass");
    check(cass!.status === "abandoned", "Cass arc abandoned (21 days idle)");
  }

  // ---- denylist filters generic entities ----
  {
    const arcs = clusterArcs(
      [
        {
          rid: "m1",
          text: "User says hi to scene narrator.",
          importance: 0.5,
          touched_at: today,
          entities: ["user", "scene", "narrator", "Real"],
        },
      ],
      NOW
    );
    check(
      arcs.length === 1 && arcs[0].primary_entity === "Real",
      "denylist drops user/scene/narrator, keeps named entity"
    );
  }

  // ---- fallback entity extraction (no metadata) ----
  {
    const arcs = clusterArcs(
      [
        {
          rid: "m1",
          text: "Ren walked through the Bookshop with Mara.",
          importance: 0.5,
          touched_at: today,
        },
        {
          rid: "m2",
          text: "Mara left the Bookshop quietly.",
          importance: 0.5,
          touched_at: today,
        },
      ],
      NOW
    );
    // Should cluster on Mara + Bookshop (each appears twice → top frequency)
    const maraArc = arcs.find((a) => a.primary_entity === "Mara");
    const bookshopArc = arcs.find((a) => a.primary_entity === "Bookshop");
    check(!!maraArc, "fallback extraction finds Mara");
    check(!!bookshopArc, "fallback extraction finds Bookshop");
  }

  // ---- summarizeActiveArcs ----
  {
    const arcs = clusterArcs(
      [
        {
          rid: "m1",
          text: "Mara talked to user.",
          importance: 0.5,
          touched_at: today,
          entities: ["Mara"],
        },
        {
          rid: "m2",
          text: "Tov arrived from north.",
          importance: 0.5,
          touched_at: recent,
          entities: ["Tov"],
        },
        {
          rid: "m3",
          text: "An old artifact was lost.",
          importance: 0.5,
          touched_at: stale,
          entities: ["Artifact"],
        },
      ],
      NOW
    );
    const line = summarizeActiveArcs(arcs);
    check(line.length > 0, "summary line non-empty");
    check(line.includes("Mara"), "summary includes active Mara arc");
    check(line.includes("Tov"), "summary includes paused Tov arc");
    check(
      !line.includes("Artifact"),
      "abandoned Artifact arc excluded from summary"
    );

    const empty = summarizeActiveArcs([]);
    check(empty === "", "empty arcs → empty summary");
  }

  // ---- sort order (active first, paused next, abandoned last) ----
  {
    const arcs = clusterArcs(
      [
        {
          rid: "m1",
          text: "Old arc.",
          importance: 0.5,
          touched_at: stale,
          entities: ["Old"],
        },
        {
          rid: "m2",
          text: "Fresh arc.",
          importance: 0.5,
          touched_at: today,
          entities: ["Fresh"],
        },
        {
          rid: "m3",
          text: "Paused arc.",
          importance: 0.5,
          touched_at: recent,
          entities: ["Paused"],
        },
      ],
      NOW
    );
    check(
      arcs[0].primary_entity === "Fresh",
      "active arc sorts first"
    );
    check(arcs[1].primary_entity === "Paused", "paused arc second");
    check(arcs[2].primary_entity === "Old", "abandoned arc last");
  }

  console.log("\n--- PASS: arc clustering ---");
}

main();
