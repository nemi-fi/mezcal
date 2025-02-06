import type { CompiledCircuit } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import { omit, range } from "lodash";
import fs from "node:fs";
import path from "node:path";
import { assert } from "ts-essentials";
import { z } from "zod";
import { promiseWithResolvers } from "../utils.js";
import { inWorkingDir, makeRunCommand } from "./utils.js";

export type OrderId = string & { __brand: "OrderId" };
export type PartyIndex = 0 | 1 | 2;
export type Side = "seller" | "buyer";

type Order = {
  side: Side;
  id: OrderId;
  inputShared: string;
  result: ReturnType<typeof promiseWithResolvers<string>>;
};

export class MpcProverService {
  // TODO: split this service into per party service to manage storage easier
  #storage: Record<PartyIndex, Map<OrderId, Order>> = {
    0: new Map(),
    1: new Map(),
    2: new Map(),
  };
  async requestProveAsParty(params: {
    orderId: OrderId;
    side: Side;
    partyIndex: PartyIndex;
    inputShared: string;
    circuit: CompiledCircuit;
    // TODO: infer number of public inputs
    numPublicInputs: number;
  }) {
    // TODO(security): authorization
    if (this.#storage[params.partyIndex].has(params.orderId)) {
      throw new Error(`order already exists ${params.orderId}`);
    }
    const order: Order = {
      id: params.orderId,
      inputShared: params.inputShared,
      side: params.side,
      result: promiseWithResolvers(),
    };
    this.#storage[params.partyIndex].set(params.orderId, order);

    this.#tryExecuteOrder(params.orderId, {
      partyIndex: params.partyIndex,
      circuit: params.circuit,
      numPublicInputs: params.numPublicInputs,
    });

    return await order.result.promise;
  }

  async #tryExecuteOrder(
    orderId: OrderId,

    params: {
      partyIndex: PartyIndex;
      circuit: CompiledCircuit;
      numPublicInputs: number;
    },
  ) {
    const order = this.#storage[params.partyIndex].get(orderId);
    if (!order) {
      throw new Error(
        `order not found in party storage ${params.partyIndex}: ${orderId}`,
      );
    }

    const otherOrders = Array.from(
      this.#storage[params.partyIndex].values(),
    ).filter((o) => o.id !== order.id && o.side !== order.side);
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
      params.partyIndex,
      omit(order, "inputShared"),
      omit(otherOrder, "inputShared"),
    );
    try {
      const { proof } = await this.proveAsParty({
        partyIndex: params.partyIndex,
        circuit: params.circuit,
        input0Shared: inputsShared[0],
        input1Shared: inputsShared[1],
        numPublicInputs: params.numPublicInputs,
      });
      console.log("got proof", orderId, params.partyIndex, proof.length);
      const proofHex = ethers.hexlify(proof);
      order.result.resolve(proofHex);
      otherOrder.result.resolve(proofHex);
    } catch (error) {
      order.result.reject(error);
      otherOrder.result.reject(error);
    }
  }

  async proveAsParty(params: {
    partyIndex: number;
    circuit: CompiledCircuit;
    input0Shared: string;
    input1Shared: string;
    // TODO: infer number of public inputs
    numPublicInputs: number;
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

      const publicInputs = z
        .string()
        .array()
        .parse(
          JSON.parse(
            fs.readFileSync(
              path.join(workingDir, "public_input.json"),
              "utf-8",
            ),
          ),
        );
      const proofData = Uint8Array.from(
        fs.readFileSync(
          path.join(workingDir, `proof.${params.partyIndex}.proof`),
        ),
      );
      // arcane magic
      const proof = ethers.getBytes(
        ethers.concat([
          proofData.slice(0, 2),
          proofData.slice(6, 100),
          proofData.slice(100 + params.numPublicInputs * 32),
        ]),
      );
      // console.log("proof native\n", JSON.stringify(Array.from(proof)));
      return { proof, publicInputs };
    });
  }

  async prove(params: {
    circuit: CompiledCircuit;
    inputs0Shared: string[];
    inputs1Shared: string[];
    // TODO: infer number of public inputs
    numPublicInputs: number;
  }) {
    assert(
      params.inputs0Shared.length === params.inputs1Shared.length,
      "inputs length mismatch",
    );
    const proofs = await Promise.all(
      range(params.inputs0Shared.length).map(async (i) => {
        const input0Shared = params.inputs0Shared[i]!;
        const input1Shared = params.inputs1Shared[i]!;
        return await this.proveAsParty({
          partyIndex: i,
          circuit: params.circuit,
          input0Shared,
          input1Shared,
          numPublicInputs: params.numPublicInputs,
        });
      }),
    );
    return proofs[0]!;
  }
}
