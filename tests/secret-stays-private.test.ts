// The marquee demo test: Saga task #23.
//
// Property under test: a secret told to Character A in a private scene must
// NOT surface in Character B's retrieval when they're later in a group
// chat — UNTIL the user tells B explicitly, at which point it becomes
// visible to B too.
//
// This is the one test that's unfakeable by prompt engineering. It requires
// the graph + visibility ACL model to actually work. If this test passes,
// the "character B can't read character A's mind" property is real.
//
// Run: npx tsx tests/secret-stays-private.test.ts

import {
  YantrikClient,
  rememberAsCanon,
} from "../src/lib/yantrikdb/client";
import { InMemoryTransport } from "../src/lib/yantrikdb/memory-transport";
import type { Character } from "../src/lib/orchestrator/types";
import {
  soloScene,
  addParticipant,
  sceneVisibleTo,
} from "../src/lib/orchestrator/scene";

function check(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ok  ${msg}`);
}

const REN: Character = {
  id: "ren",
  name: "Ren",
  description: "A calm bookseller.",
};
const MEI: Character = {
  id: "mei",
  name: "Mei",
  description: "Ren's neighbor, a wandering journalist.",
};

const SECRET = "User is secretly planning to move away from the coastal town";
const SHARED_FACT = "The coastal town hosts a lantern festival every autumn";

async function main(): Promise<void> {
  console.log("--- secret-stays-private test (marquee demo) ---");

  const transport = new InMemoryTransport();
  const client = new YantrikClient(transport);

  // World canon — visible to everyone
  await client.remember(
    rememberAsCanon(SHARED_FACT, "seed", {
      world_id: "coast-world",
      visible_to: ["*"],
    })
  );

  // Scene 1: user + Ren, private
  const soloWithRen = soloScene(REN.id);
  console.log("\n[scene 1] user alone with Ren, visible_to =", sceneVisibleTo(soloWithRen));
  await client.remember(
    rememberAsCanon(SECRET, "sess-1", {
      character_id: REN.id,
      world_id: "coast-world",
      visible_to: sceneVisibleTo(soloWithRen),
    })
  );

  // Verify: Ren's retrieval includes the secret
  const renBefore = await client.recall({
    query: "user's plans",
    namespace: `character:${REN.id}`,
    speaker: REN.id,
    top_k: 10,
  });
  check(
    renBefore.results.some((r) => r.text === SECRET),
    "Ren can see the secret he was told"
  );

  // Verify: Mei's retrieval does NOT include the secret, but DOES include
  // world canon. Mimics the orchestrator's dual-namespace recall
  // (character + world) in parallel.
  const [meiCharView, meiWorldView] = await Promise.all([
    client.recall({
      query: "user's plans",
      namespace: `character:${REN.id}`,
      speaker: MEI.id,
      top_k: 10,
    }),
    client.recall({
      query: "festival town",
      namespace: "world:coast-world",
      speaker: MEI.id,
      top_k: 10,
    }),
  ]);
  check(
    !meiCharView.results.some((r) => r.text === SECRET),
    "Mei CANNOT see the secret (not a participant of the private scene)"
  );
  check(
    meiWorldView.results.some((r) => r.text === SHARED_FACT),
    "Mei CAN see shared world canon (visible_to=*)"
  );

  // Scene 2: group — Ren and Mei both present
  const groupScene = addParticipant(soloWithRen, MEI.id);
  console.log("\n[scene 2] group scene with Ren and Mei, visible_to =", sceneVisibleTo(groupScene));

  // Ren has NOT told Mei the secret yet. Mei asks something; her retrieval
  // must still not include the secret even though she's now in a scene with
  // Ren.
  const meiInGroupBeforeTold = await client.recall({
    query: "user's plans",
    namespace: `character:${REN.id}`,
    speaker: MEI.id,
    top_k: 10,
  });
  check(
    !meiInGroupBeforeTold.results.some((r) => r.text === SECRET),
    "Mei STILL cannot see the secret just by being in the same scene later"
  );

  // User now repeats the secret in the group scene, so Mei hears it.
  // Orchestrator writes a NEW memory with the group scene's visible_to —
  // it does NOT mutate the original memory's visibility.
  await client.remember(
    rememberAsCanon(SECRET, "sess-2", {
      character_id: REN.id,
      world_id: "coast-world",
      visible_to: sceneVisibleTo(groupScene),
    })
  );

  // Now Mei can see the secret via the NEW memory, not the old one.
  const meiAfterTold = await client.recall({
    query: "user's plans",
    namespace: `character:${REN.id}`,
    speaker: MEI.id,
    top_k: 10,
  });
  check(
    meiAfterTold.results.some((r) => r.text === SECRET),
    "Mei CAN see the secret AFTER being told in the group scene"
  );

  // Provenance preserved: there are TWO memories with the secret text now.
  const allWithSecret = transport.all().filter((m) => m.text === SECRET);
  check(
    allWithSecret.length === 2,
    `two distinct memories exist (provenance preserved), got ${allWithSecret.length}`
  );
  const firstVisible = allWithSecret[0].metadata.visible_to as string[];
  const secondVisible = allWithSecret[1].metadata.visible_to as string[];
  check(
    !firstVisible.includes(MEI.id),
    "original memory's visible_to was NOT mutated (Mei not added)"
  );
  check(
    secondVisible.includes(MEI.id),
    "second memory records Mei as audience"
  );

  // Adversarial: a THIRD character, not in any scene, never sees the secret.
  const ghostSpeaker = "ghost-character";
  const ghostView = await client.recall({
    query: "user's plans",
    namespace: `character:${REN.id}`,
    speaker: ghostSpeaker,
    top_k: 10,
  });
  check(
    !ghostView.results.some((r) => r.text === SECRET),
    "third-party character never in any scene CANNOT see the secret"
  );

  console.log("\n--- PASS: secret-stays-private ---");
}

main().catch((err) => {
  console.error("Test threw:", err);
  process.exit(1);
});
