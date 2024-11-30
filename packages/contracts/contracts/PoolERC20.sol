// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Fr, FrLib, keccak256ToFr} from "./Fr.sol";
import {NoteInput, castAddressToBytes32, TokenAmount, Call, Execution, MAX_TOKENS_IN_PER_EXECUTION, MAX_TOKENS_OUT_PER_EXECUTION} from "./Utils.sol";
import {RouterERC20} from "./RouterERC20.sol";
import {PoolGeneric} from "./PoolGeneric.sol";
import {UltraVerifier as ShieldVerifier} from "../noir/target/shield.sol";
import {UltraVerifier as TransferVerifier} from "../noir/target/transfer.sol";
import {UltraVerifier as ExecuteVerifier} from "../noir/target/execute.sol";
import {UltraVerifier as RollupVerifier} from "../noir/target/rollup.sol";

contract PoolERC20 is PoolGeneric {
    using SafeERC20 for IERC20;
    using FrLib for Fr;

    struct Storage {
        RouterERC20 router;
        ShieldVerifier shieldVerifier;
        TransferVerifier transferVerifier;
        ExecuteVerifier executeVerifier;
    }

    constructor(
        RouterERC20 router,
        ShieldVerifier shieldVerifier,
        TransferVerifier transferVerifier,
        ExecuteVerifier executeVerifier,
        RollupVerifier rollupVerifier
    ) PoolGeneric(rollupVerifier) {
        $().router = router;
        $().shieldVerifier = shieldVerifier;
        $().transferVerifier = transferVerifier;
        $().executeVerifier = executeVerifier;
    }

    function shield(
        bytes calldata proof,
        IERC20 token,
        uint256 amount,
        NoteInput calldata note
    ) external {
        token.safeTransferFrom(msg.sender, address(this), amount);

        bytes32[] memory publicInputs = new bytes32[](3);
        publicInputs[0] = castAddressToBytes32(address(token));
        publicInputs[1] = bytes32(amount);
        publicInputs[2] = note.noteHash;
        require(
            $().shieldVerifier.verify(proof, publicInputs),
            "Invalid shield proof"
        );

        NoteInput[] memory noteInputs = new NoteInput[](1);
        noteInputs[0] = note;
        bytes32[] memory nullifiers;
        _PoolGeneric_addPendingTx(noteInputs, nullifiers);
    }

    function transfer(
        bytes calldata proof,
        bytes32 nullifier,
        NoteInput calldata changeNote,
        NoteInput calldata toNote
    ) external {
        bytes32[] memory publicInputs = new bytes32[](5);
        publicInputs[0] = noteHashTree.root;
        publicInputs[1] = nullifierTree.root;
        publicInputs[2] = nullifier;
        publicInputs[3] = changeNote.noteHash;
        publicInputs[4] = toNote.noteHash;
        require(
            $().transferVerifier.verify(proof, publicInputs),
            "Invalid transfer proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](2);
            noteInputs[0] = changeNote;
            noteInputs[1] = toNote;
            bytes32[] memory nullifiers = new bytes32[](1);
            nullifiers[0] = nullifier;
            _PoolGeneric_addPendingTx(noteInputs, nullifiers);
        }
    }

    function execute(
        bytes calldata proof,
        Execution calldata execution,
        bytes32 wrappedExecutionHash,
        NoteInput[MAX_TOKENS_IN_PER_EXECUTION] calldata noteInputs,
        NoteInput[MAX_TOKENS_OUT_PER_EXECUTION] calldata changeNoteInputs,
        bytes32[MAX_TOKENS_OUT_PER_EXECUTION] calldata nullifiers
    ) external {
        require(execution.calls.length > 0, "No calls");
        Fr executionHash = keccak256ToFr(abi.encode(execution));

        bytes32[] memory publicInputs = new bytes32[](
            // tree roots
            2 +
                // execution hashes
                2 +
                // amounts in & out
                (2 *
                    (MAX_TOKENS_IN_PER_EXECUTION +
                        MAX_TOKENS_OUT_PER_EXECUTION)) +
                // note hashes in
                MAX_TOKENS_IN_PER_EXECUTION +
                // change note hashes out
                MAX_TOKENS_OUT_PER_EXECUTION +
                // nullifiers out
                MAX_TOKENS_OUT_PER_EXECUTION
        );
        uint256 p = 0;
        // trees
        publicInputs[p++] = noteHashTree.root;
        publicInputs[p++] = nullifierTree.root;
        // execution
        publicInputs[p++] = executionHash.toBytes32();
        publicInputs[p++] = wrappedExecutionHash;
        // amounts in
        for (uint256 i = 0; i < execution.amountsIn.length; i++) {
            publicInputs[p++] = castAddressToBytes32(
                address(execution.amountsIn[i].token)
            );
            publicInputs[p++] = bytes32(execution.amountsIn[i].amount);
        }
        // amounts out
        for (uint256 i = 0; i < execution.amountsOut.length; i++) {
            publicInputs[p++] = castAddressToBytes32(
                address(execution.amountsOut[i].token)
            );
            publicInputs[p++] = bytes32(execution.amountsOut[i].amount);
        }
        // note hashes in
        for (uint256 i = 0; i < noteInputs.length; i++) {
            publicInputs[p++] = noteInputs[i].noteHash;
        }
        // change note hashes out
        for (uint256 i = 0; i < changeNoteInputs.length; i++) {
            publicInputs[p++] = changeNoteInputs[i].noteHash;
        }
        // nullifiers out
        for (uint256 i = 0; i < nullifiers.length; i++) {
            publicInputs[p++] = nullifiers[i];
        }
        require(p == publicInputs.length, "Invalid execute public inputs");
        require(
            $().executeVerifier.verify(proof, publicInputs),
            "Invalid execute proof"
        );

        {
            // execute
            RouterERC20 router_ = $().router; // gas savings
            for (uint256 i = 0; i < execution.amountsOut.length; i++) {
                TokenAmount memory tokenAmount = execution.amountsOut[i];
                if (tokenAmount.amount > 0) {
                    tokenAmount.token.safeTransfer(
                        address(router_),
                        tokenAmount.amount
                    );
                }
            }
            router_.execute(execution.calls, execution.amountsIn);
        }

        {
            // save note hashes & nullifiers
            NoteInput[] memory noteInputsDyn = new NoteInput[](
                noteInputs.length + changeNoteInputs.length
            );
            uint256 noteInputsI = 0;
            for (uint256 i = 0; i < noteInputs.length; i++) {
                if (noteInputs[i].noteHash != 0) {
                    noteInputsDyn[noteInputsI++] = noteInputs[i];
                }
            }
            for (uint256 i = 0; i < changeNoteInputs.length; i++) {
                if (changeNoteInputs[i].noteHash != 0) {
                    noteInputsDyn[noteInputsI++] = changeNoteInputs[i];
                }
            }
            assembly {
                // shrink to actual length
                mstore(noteInputsDyn, noteInputsI)
            }
            bytes32[] memory nullifiersDyn = new bytes32[](nullifiers.length);
            uint256 nullifiersI = 0;
            for (uint256 i = 0; i < nullifiers.length; i++) {
                if (nullifiers[i] != 0) {
                    nullifiersDyn[nullifiersI++] = nullifiers[i];
                }
            }
            assembly {
                // shrink to actual length
                mstore(nullifiersDyn, nullifiersI)
            }
            _PoolGeneric_addPendingTx(noteInputsDyn, nullifiersDyn);
        }
    }

    function $() private pure returns (Storage storage s) {
        assembly {
            s.slot := STORAGE_SLOT
        }
    }
}

// keccak256("storage.PoolERC20") - 1
bytes32 constant STORAGE_SLOT = 0x2f64cf42bfffdfbf199004d3529d110e06f94674b975e86640e5dc11173fedfe;
