// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {PoolGeneric} from "../PoolGeneric.sol";
import {NoteInput} from "../Utils.sol";
import {UltraVerifier as RollupVerifier} from "../../noir/target/rollup.sol";

contract MockPoolGeneric is PoolGeneric {
    constructor(RollupVerifier rollupVerifier_) PoolGeneric(rollupVerifier_) {}

    function addPendingTx(
        NoteInput[] memory noteInputs,
        bytes32[] memory nullifiers
    ) external {
        _PoolGeneric_addPendingTx(noteInputs, nullifiers);
    }
}
