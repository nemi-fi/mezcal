import type { CompiledCircuit } from "@noir-lang/noir_js";
import { ethers } from "ethers";
import { omit } from "lodash";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { promiseWithResolvers } from "../utils.js";
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
      // TODO: infer number of public inputs
      numPublicInputs: number;
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
    // TODO: infer number of public inputs
    numPublicInputs: number;
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
      numPublicInputs: params.numPublicInputs,
    });

    return await order.result.promise;
  }

  async #tryExecuteOrder(
    orderId: OrderId,

    params: {
      circuit: CompiledCircuit;
      numPublicInputs: number;
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
      const { proof } = await this.#prove({
        circuit: params.circuit,
        input0Shared: inputsShared[0],
        input1Shared: inputsShared[1],
        numPublicInputs: params.numPublicInputs,
      });
      const proofHex = ethers.hexlify(proof);
      order.result.resolve(proofHex);
      otherOrder.result.resolve(proofHex);
    } catch (error) {
      order.result.reject(error);
      otherOrder.result.reject(error);
    }
  }

  async #prove(params: {
    circuit: CompiledCircuit;
    input0Shared: string;
    input1Shared: string;
    // TODO: infer number of public inputs
    numPublicInputs: number;
  }) {
    console.log("proving as party", this.partyIndex);
    return await inWorkingDir(async (workingDir) => {
      for (const [traderIndex, inputShared] of [
        params.input0Shared,
        params.input1Shared,
      ].entries()) {
        fs.writeFileSync(
          path.join(
            workingDir,
            `Prover${traderIndex}.toml.${this.partyIndex}.shared`,
          ),
          ethers.getBytes(inputShared),
        );
      }

      const circuitPath = path.join(workingDir, "circuit.json");
      fs.writeFileSync(circuitPath, JSON.stringify(params.circuit));

      const runCommand = makeRunCommand(__dirname);
      await runCommand(
        `./run-party.sh ${workingDir} ${circuitPath} ${this.partyIndex}`,
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
          path.join(workingDir, `proof.${this.partyIndex}.proof`),
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
