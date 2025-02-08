import { UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import { omit } from "lodash";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

    this.#tryExecuteOrder(params.orderId, {
      circuit: params.circuit,
    });

    return await order.result.promise;
  }

  async #tryExecuteOrder(
    orderId: OrderId,
    params: {
      circuit: CompiledCircuit;
    },
  ) {
    const order = this.#storage.get(orderId);
    if (!order) {
      throw new Error(
        `order not found in party storage ${this.partyIndex}: ${orderId}`,
      );
    }

    const otherOrders = Array.from(this.#storage.values()).filter(
      (o) => o.id !== order.id && o.side !== order.side,
    );
    if (otherOrders.length === 0) {
      return;
    }
    const otherOrder = otherOrders[0]!;
    const inputsShared =
      order.side === "seller"
        ? ([order.inputShared, otherOrder.inputShared] as const)
        : ([otherOrder.inputShared, order.inputShared] as const);
    console.log(
      "executing orders",
      this.partyIndex,
      omit(order, ["inputShared", "result"]),
      omit(otherOrder, ["inputShared", "result"]),
    );
    try {
      const { proof } = await proveAsParty({
        circuit: params.circuit,
        partyIndex: this.partyIndex,
        input0Shared: inputsShared[0],
        input1Shared: inputsShared[1],
      });
      const proofHex = ethers.hexlify(proof);
      order.result.resolve(proofHex);
      otherOrder.result.resolve(proofHex);
      this.#storage.delete(order.id);
      this.#storage.delete(otherOrder.id);
    } catch (error) {
      order.result.reject(error);
      otherOrder.result.reject(error);
    }
  }
}

async function proveAsParty(params: {
  partyIndex: number;
  circuit: CompiledCircuit;
  input0Shared: string;
  input1Shared: string;
}) {
  console.log("proving as party", params.partyIndex);
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
    await runCommand(
      `./run-party.sh ${workingDir} ${circuitPath} ${params.partyIndex}`,
    );

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
