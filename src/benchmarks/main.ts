import * as collabs from "@collabs/collabs";
import { CTextLogn } from "../crdt/text_logn";
import { CTextLognGroundTruth } from "./old_crdts/ground_truth";
import { CTextLognBalanced } from "./old_crdts/balanced";
import fs = require("fs");
import path = require("path");
import { edits, finalText } from "./trace/real_text_trace_edits";
import { getMemoryUsed } from "./util";
import { assert } from "chai";
import seedrandom = require("seedrandom");

type ICText =
  | collabs.CText
  | CTextLognGroundTruth
  | CTextLognBalanced
  | CTextLogn;

const IMPLEMENTATIONS: {
  [name: string]: new (initToken: collabs.InitToken) => ICText;
} = {
  collabs: collabs.CText,
  ground: CTextLognGroundTruth,
  balanced: CTextLognBalanced,
  logn: CTextLogn,
};

const SEED = "42";

const warmupTrials = 5;
const recordedTrials = 10;

const AVG_INTERVAL = 1000; // number of ops to average in output data

/**
 * Benchmark times of a single user sending all ops.
 *
 * @return averages in ns
 */
async function single(implementation: string): Promise<number[]> {
  // Sum of times per measurement across all trials, in ns.
  const sums = new Array<number>(Math.floor(edits.length / AVG_INTERVAL));
  sums.fill(0);

  for (let trial = -warmupTrials; trial < recordedTrials; trial++) {
    console.log("  Trial: " + trial);

    // Force GC.
    await getMemoryUsed();

    const rng = seedrandom(SEED);
    const app = new collabs.CRDTApp({
      batchingStrategy: new collabs.ManualBatchingStrategy(),
      causalityGuaranteed: true,
      debugReplicaID: collabs.pseudoRandomReplicaID(rng),
    });
    const text = app.registerCollab(
      "",
      collabs.Pre(IMPLEMENTATIONS[implementation])()
    );
    app.load(collabs.Optional.empty());

    for (let measurement = 0; measurement < sums.length; measurement++) {
      const start = process.hrtime.bigint();

      for (
        let op = measurement * AVG_INTERVAL;
        op < (measurement + 1) * AVG_INTERVAL;
        op++
      ) {
        processEdit(text, op);
      }

      const end = process.hrtime.bigint();
      if (trial >= 0) {
        sums[measurement] += new Number(end - start).valueOf() / AVG_INTERVAL;
      }
    }

    if (trial === -warmupTrials) {
      // Finish and check the answer.
      for (let op = sums.length * AVG_INTERVAL; op < edits.length; op++) {
        processEdit(text, op);
      }
      assert.strictEqual(finalText, text.toString());
    }
  }

  return sums.map((value) => value / recordedTrials);
}

function processEdit(text: ICText, op: number) {
  const edit = edits[op];
  if (edit[2] !== undefined) {
    // Insert edit[2] at edit[0]
    text.insert(edit[0], edit[2]);
  } else {
    // Delete character at edit[0]
    text.delete(edit[0]);
  }
}

const NUM_CONCURRENT = 10;
const OPS_PER_SENDER = 100;
const MULTI_AVG_INTERVAL = 5;

/**
 * Benchmark times of multiple users sending long LtR sequences concurrently.
 *
 * @return averages in ns
 */
async function multi(implementation: string): Promise<number[]> {
  const rng = seedrandom(SEED);

  // Create messages.
  const messages: Uint8Array[] = [];
  for (let i = 0; i < NUM_CONCURRENT; i++) {
    const app = new collabs.CRDTApp({
      batchingStrategy: new collabs.ManualBatchingStrategy(),
      causalityGuaranteed: true,
      debugReplicaID: collabs.pseudoRandomReplicaID(rng),
    });
    app.on("Send", (e) => messages.push(e.message));
    const text = app.registerCollab(
      "",
      collabs.Pre(IMPLEMENTATIONS[implementation])()
    );
    app.load(collabs.Optional.empty());
    for (let i = 0; i < OPS_PER_SENDER; i++) {
      text.insert(text.length, "a");
      app.commitBatch();
    }
  }
  assert.strictEqual(NUM_CONCURRENT * OPS_PER_SENDER, messages.length);

  // Sum of times per measurement across all trials, in ns.
  const sums = new Array<number>(
    Math.floor(messages.length / MULTI_AVG_INTERVAL)
  );
  sums.fill(0);

  for (let trial = -warmupTrials; trial < recordedTrials; trial++) {
    console.log("  Trial: " + trial);

    // Force GC.
    await getMemoryUsed();

    const rng = seedrandom(SEED);
    const app = new collabs.CRDTApp({
      batchingStrategy: new collabs.ManualBatchingStrategy(),
      causalityGuaranteed: true,
      debugReplicaID: collabs.pseudoRandomReplicaID(rng),
    });
    app.registerCollab("", collabs.Pre(IMPLEMENTATIONS[implementation])());
    app.load(collabs.Optional.empty());

    for (let measurement = 0; measurement < sums.length; measurement++) {
      const start = process.hrtime.bigint();

      for (
        let op = measurement * MULTI_AVG_INTERVAL;
        op < (measurement + 1) * MULTI_AVG_INTERVAL;
        op++
      ) {
        app.receive(messages[op]);
      }

      const end = process.hrtime.bigint();
      if (trial >= 0) {
        sums[measurement] +=
          new Number(end - start).valueOf() / MULTI_AVG_INTERVAL;
      }
    }
  }

  return sums.map((value) => value / recordedTrials);
}

// Main

function error(message: string) {
  console.log("Error: " + message);
  console.log("Usage: npm run benchmarks <outfolder>");
  process.exit(1);
}

(async function () {
  const args = process.argv.slice(2);
  if (args.length !== 1) error("Wrong number of arguments");
  const folder = args[0];

  {
    // Single benchmark.
    const file = path.join(folder, "single.csv");
    // CSV header.
    fs.writeFileSync(file, "Implementation,Op,Average (ns)\n");
    // Implementations.
    for (const implementation of Object.keys(IMPLEMENTATIONS)) {
      console.log("Implementation: " + implementation);
      const avgs = await single(implementation);
      const csvLines = avgs.map(
        (avg, i) => implementation + "," + i * AVG_INTERVAL + "," + avg
      );
      fs.appendFileSync(file, csvLines.join("\n") + "\n");
    }
  }

  {
    // Multi benchmark.
    const file = path.join(folder, "multi.csv");
    // CSV header.
    fs.writeFileSync(file, "Implementation,Op,Average (ns)\n");
    // Implementations.
    for (const implementation of Object.keys(IMPLEMENTATIONS)) {
      console.log("Implementation: " + implementation);
      const avgs = await multi(implementation);
      const csvLines = avgs.map(
        (avg, i) => implementation + "," + i * MULTI_AVG_INTERVAL + "," + avg
      );
      fs.appendFileSync(file, csvLines.join("\n") + "\n");
    }
  }
})();
