// Verify the lorebook scanner activates entries correctly by triggers,
// respects selective + constant + case_sensitive + position + insertion_order.
// Run: npx tsx tests/lorebook.test.ts

import { YantrikClient, rememberAsCanon } from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import {
  scanLorebook,
  partitionByPosition,
} from "../src/lib/orchestrator/lorebook";
import type { LorebookEntryMeta } from "../src/lib/yantrikdb/types";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

async function seedEntry(
  client: YantrikClient,
  character_id: string,
  content: string,
  meta: Partial<LorebookEntryMeta>
): Promise<void> {
  const input = rememberAsCanon(content, "seed", {
    character_id,
    lorebook_entry: {
      keys: [],
      position: "after_char",
      insertion_order: 100,
      case_sensitive: false,
      enabled: true,
      ...meta,
    } as LorebookEntryMeta,
  });
  await client.remember({ ...input, namespace: `lorebook:${character_id}` });
}

async function main(): Promise<void> {
  console.log("--- lorebook scanner test ---");

  const transport = new InMemoryTransport();
  const client = new YantrikClient(transport);
  const CHAR = "test-char-lore";

  await seedEntry(client, CHAR, "The Crimson Sword hums with old magic.", {
    keys: ["crimson sword", "sword"],
    position: "after_char",
    insertion_order: 50,
  });
  await seedEntry(client, CHAR, "King Alistair rules from the marble throne.", {
    keys: ["alistair", "king"],
    position: "after_char",
    insertion_order: 10,
  });
  await seedEntry(client, CHAR, "This world is set in the year 1423.", {
    keys: [],
    constant: true,
    position: "before_char",
    insertion_order: 1,
  });
  await seedEntry(
    client,
    CHAR,
    "The priests only speak of the sword in hushed tones when at the altar.",
    {
      keys: ["sword"],
      secondary_keys: ["priest", "altar"],
      selective: true,
      position: "after_char",
      insertion_order: 5,
    }
  );
  await seedEntry(client, CHAR, "This entry is disabled and should never show.", {
    keys: ["sword"],
    enabled: false,
    position: "after_char",
    insertion_order: 2,
  });

  // Scan with a plain mention of the sword — constant entry + "crimson sword"
  // entry should activate. Selective entry should NOT (no priest/altar).
  {
    const activated = await scanLorebook(client, {
      character_id: CHAR,
      recent_text: "I lifted the crimson sword from the stone.",
    });
    const texts = activated.map((e) => e.content);
    check(
      texts.some((t) => t.includes("Crimson Sword hums")),
      "sword entry activates on primary key match"
    );
    check(
      texts.some((t) => t.includes("year 1423")),
      "constant entry always active"
    );
    check(
      !texts.some((t) => t.includes("priests only speak")),
      "selective entry does NOT activate without secondary key"
    );
    check(
      !texts.some((t) => t.includes("Alistair") || t.includes("marble throne")),
      "unrelated entry does NOT activate"
    );
    check(
      !texts.some((t) => t.includes("disabled and should never show")),
      "disabled entry does NOT activate"
    );
  }

  // Scan with sword AND priest/altar — selective entry now activates too.
  {
    const activated = await scanLorebook(client, {
      character_id: CHAR,
      recent_text:
        "At the altar, the priest spoke softly of the sword's age.",
    });
    const texts = activated.map((e) => e.content);
    check(
      texts.some((t) => t.includes("priests only speak")),
      "selective entry activates when both primary and secondary keys match"
    );
  }

  // Insertion order — entries sort ascending within position group.
  {
    const activated = await scanLorebook(client, {
      character_id: CHAR,
      recent_text: "The king approaches with the crimson sword at his side.",
    });
    const afterGroup = activated.filter((e) => e.position === "after_char");
    const orders = afterGroup.map((e) => e.insertion_order);
    check(
      orders.every((n, i) => i === 0 || orders[i - 1] <= n),
      `after_char entries sorted by insertion_order asc (got ${orders.join(",")})`
    );
  }

  // Partition helper splits position groups correctly.
  {
    const activated = await scanLorebook(client, {
      character_id: CHAR,
      recent_text: "sword",
    });
    const { before, after } = partitionByPosition(activated);
    check(before.includes("year 1423"), "constant before_char lands in `before`");
    check(
      after.includes("Crimson Sword"),
      "sword entry lands in `after` (its position)"
    );
    check(
      !before.includes("Crimson Sword"),
      "sword entry does NOT appear in before"
    );
  }

  // Case sensitivity
  await seedEntry(client, CHAR, "Case-sensitive entry for SwordFist.", {
    keys: ["SwordFist"],
    case_sensitive: true,
    position: "after_char",
    insertion_order: 200,
  });
  {
    const a1 = await scanLorebook(client, {
      character_id: CHAR,
      recent_text: "I use swordfist technique.",
    });
    check(
      !a1.some((e) => e.content.includes("Case-sensitive")),
      "case-sensitive key does not match lowercased text"
    );
    const a2 = await scanLorebook(client, {
      character_id: CHAR,
      recent_text: "I use SwordFist technique.",
    });
    check(
      a2.some((e) => e.content.includes("Case-sensitive")),
      "case-sensitive key matches exact case"
    );
  }

  console.log("\n--- PASS: lorebook ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
