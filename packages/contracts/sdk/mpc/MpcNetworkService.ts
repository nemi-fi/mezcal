import { UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { utils } from "@repo/utils";
import { ethers } from "ethers";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import PQueue, { type QueueAddOptions } from "p-queue";
import { decodeNativeHonkProof, promiseWithResolvers } from "../utils.js";
import { inWorkingDir, makeRunCommand, splitInput } from "./utils.js";

export class MpcProverService {
  readonly #parties = {
    0: new MpcProverPartyService(0),
    1: new MpcProverPartyService(1),
    2: new MpcProverPartyService(2),
  };

  async prove(
    inputsShared: Awaited<ReturnType<typeof splitInput>>,
    params: {
      orderId: OrderId;
      side: Side;
      circuit: CompiledCircuit;
    },
  ) {
    return await Promise.all(
      inputsShared.map(async ({ partyIndex, inputShared }) => {
        return await this.#parties[partyIndex].requestProveAsParty({
          ...params,
          inputShared,
        });
      }),
    );
  }
}

class MpcProverPartyService {
  #storage: Map<OrderId, Order> = new Map();
  #queue = new PQueue({ concurrency: 1 });

  constructor(readonly partyIndex: PartyIndex) {}

  async requestProveAsParty(params: {
    orderId: OrderId;
    side: Side;
    inputShared: string;
    circuit: CompiledCircuit;
  }) {
    // TODO(security): authorization
    if (this.#storage.has(params.orderId)) {
      throw new Error(`order already exists ${params.orderId}`);
    }
    const order: Order = {
      id: params.orderId,
      inputShared: params.inputShared,
      side: params.side,
      result: promiseWithResolvers(),
    };
    this.#storage.set(params.orderId, order);

    // add this order to other order's queue
    // TODO(perf): this is O(N^2) but we should do better
    for (const otherOrder of this.#storage.values()) {
      this.#addOrdersToQueue({
        orderAId: order.id,
        orderBId: otherOrder.id,
        circuit: params.circuit,
      });
    }

    return await order.result.promise;
  }

  #addOrdersToQueue(params: {
    orderAId: OrderId;
    orderBId: OrderId;
    circuit: CompiledCircuit;
  }) {
    const options: QueueAddOptions = {
      throwOnTimeout: true,
      // this is a hack to enforce the order of execution matches across all MPC parties
      priority: Number(
        ethers.getBigInt(
          ethers.id([params.orderAId, params.orderBId].sort().join("")),
        ) % BigInt(Number.MAX_SAFE_INTEGER),
      ),
    };
    this.#queue.add(async () => {
      await utils.sleep(500); // just to make sure all parties got the order over network
      const orderA = this.#storage.get(params.orderAId);
      const orderB = this.#storage.get(params.orderBId);
      if (!orderA || !orderB) {
        // one of the orders was already matched
        return;
      }
      if (orderA.id === orderB.id) {
        // can't match with itself
        return;
      }
      if (orderA.side === orderB.side) {
        // pre-check that orders are on opposite sides
        return;
      }

      // deterministic ordering
      const [order0, order1] =
        orderA.side === "seller" ? [orderA, orderB] : [orderB, orderA];
      console.log("executing orders", this.partyIndex, order0.id, order1.id);
      try {
        const { proof } = await proveAsParty({
          circuit: params.circuit,
          partyIndex: this.partyIndex,
          input0Shared: order0.inputShared,
          input1Shared: order1.inputShared,
        });
        const proofHex = ethers.hexlify(proof);
        order0.result.resolve(proofHex);
        order1.result.resolve(proofHex);
        this.#storage.delete(order0.id);
        this.#storage.delete(order1.id);
        console.log(
          `orders matched: ${this.partyIndex} ${order0.id} ${order1.id}`,
        );
      } catch (error) {
        console.log(
          `orders did not match: ${this.partyIndex} ${order0.id} ${order1.id}`,
        );
      }
    }, options);
  }
}

async function proveAsParty(params: {
  partyIndex: number;
  circuit: CompiledCircuit;
  input0Shared: string;
  input1Shared: string;
}) {
  return await inWorkingDir(async (workingDir) => {
    for (const [traderIndex, inputShared] of [
      params.input0Shared,
      params.input1Shared,
    ].entries()) {
      fs.writeFileSync(
        path.join(
          workingDir,
          `Prover${traderIndex}.toml.${params.partyIndex}.shared`,
        ),
        ethers.getBytes(inputShared),
      );
    }

    const circuitPath = path.join(workingDir, "circuit.json");
    fs.writeFileSync(circuitPath, JSON.stringify(params.circuit));

    const runCommand = makeRunCommand(__dirname);
    await runCommand("./run-party.sh", [
      workingDir,
      circuitPath,
      params.partyIndex,
    ]);

    const { proof, publicInputs } = decodeNativeHonkProof(
      fs.readFileSync(
        path.join(workingDir, `proof.${params.partyIndex}.proof`),
      ),
    );

    // pre-verify proof
    const backend = new UltraHonkBackend(params.circuit.bytecode, {
      threads: os.cpus().length,
    });
    let verified: boolean;
    try {
      verified = await backend.verifyProof(
        { proof, publicInputs },
        { keccak: true },
      );
    } catch (e: any) {
      if (e.message?.includes("unreachable")) {
        throw new Error("mpc generated invalid proof: failed in runtime");
      }
      throw e;
    } finally {
      await backend.destroy();
    }
    if (!verified) {
      throw new Error("mpc generated invalid proof: returned false");
    }

    return {
      proof: proof.slice(4), // remove length
      publicInputs,
    };
  });
}

export type OrderId = string & { __brand: "OrderId" };
export type PartyIndex = 0 | 1 | 2;
/**
 * Deterministically determined based on the tokens being swapped
 */
export type Side = "seller" | "buyer";

type Order = {
  side: Side;
  id: OrderId;
  inputShared: string;
  result: ReturnType<typeof promiseWithResolvers<string>>;
};
