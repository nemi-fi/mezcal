// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {HeaderLib} from "@aztec/l1-contracts/src/core/libraries/HeaderLib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Fr, FrLib, keccak256ToFr} from "./Fr.sol";
import {castAddressToBytes32, TokenAmount, Call, Execution, MAX_TOKENS_IN_PER_EXECUTION, MAX_TOKENS_OUT_PER_EXECUTION} from "./Utils.sol";
import {RouterERC20} from "./RouterERC20.sol";
import {UltraVerifier as ShieldVerifier} from "../noir/target/shield.sol";
import {UltraVerifier as RollupVerifier} from "../noir/target/rollup.sol";
import {UltraVerifier as TransferVerifier} from "../noir/target/transfer.sol";
import {UltraVerifier as ExecuteVerifier} from "../noir/target/execute.sol";

// Note: keep in sync with other languages
uint32 constant MAX_NOTES_PER_ROLLUP = 64;
// Note: keep in sync with other languages
uint32 constant MAX_NULLIFIERS_PER_ROLLUP = 64;

struct PendingTx {
    bool rolledUp;
    Fr[] noteHashes;
    Fr[] nullifiers;
}

struct NoteInput {
    bytes32 noteHash;
    bytes encryptedNote;
}

// TODO: break this contract into a general rollup (note, nullifiers, pending txs) and ERC20 specific methods (shield, transfer)
contract PoolERC20 {
    using SafeERC20 for IERC20;
    using FrLib for Fr;

    error TxAlreadyRolledUp(uint256 txIndex);

    ShieldVerifier public immutable shieldVerifier;
    TransferVerifier public immutable transferVerifier;
    ExecuteVerifier public immutable executeVerifier;
    RollupVerifier public immutable rollupVerifier;

    RouterERC20 public router;

    PendingTx[] allPendingTxs;

    // TODO(perf): emit only the ciphertext
    event EncryptedNotes(NoteInput[] encryptedNotes);

    // TODO(perf): use dynamic array to save on gas costs
    event NoteHashes(
        uint256 indexed index,
        Fr[MAX_NOTES_PER_ROLLUP] noteHashes
    );
    error NoteHashExists(Fr noteHash);
    mapping(Fr => bool) public noteHashExists;
    HeaderLib.AppendOnlyTreeSnapshot noteHashTree;
    uint256 noteHashBatchIndex;

    // TODO(perf): use dynamic array to save on gas costs
    event Nullifiers(
        uint256 indexed index,
        Fr[MAX_NULLIFIERS_PER_ROLLUP] nullifiers
    );
    error NullifierExists(Fr nullifier);
    mapping(Fr => bool) public nullifierExists;
    HeaderLib.AppendOnlyTreeSnapshot nullifierTree;
    uint256 nullifierBatchIndex;

    constructor(
        RouterERC20 router_,
        ShieldVerifier shieldVerifier_,
        TransferVerifier transferVerifier_,
        ExecuteVerifier executeVerifier_,
        RollupVerifier rollupVerifier_
    ) {
        router = router_;

        shieldVerifier = shieldVerifier_;
        transferVerifier = transferVerifier_;
        executeVerifier = executeVerifier_;
        rollupVerifier = rollupVerifier_;

        noteHashTree
            .root = 0x1fd848aa69e1633722fe249a5b7f53b094f1c9cef9f5c694b073fd1cc5850dfb; // empty tree
        nullifierTree
            .root = 0x0aa63c509390ad66ecd821998aabb16a818bcc5db5cf4accc0ce1821745244e9; // nullifier tree filled with 1 canonical subtree of nullifiers
        nullifierTree.nextAvailableLeafIndex = MAX_NULLIFIERS_PER_ROLLUP;
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
            shieldVerifier.verify(proof, publicInputs),
            "Invalid shield proof"
        );

        NoteInput[] memory noteInputs = new NoteInput[](1);
        noteInputs[0] = note;
        bytes32[] memory nullifiers;
        _addPendingTx(noteInputs, nullifiers);
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
            transferVerifier.verify(proof, publicInputs),
            "Invalid transfer proof"
        );

        {
            NoteInput[] memory noteInputs = new NoteInput[](2);
            noteInputs[0] = changeNote;
            noteInputs[1] = toNote;
            bytes32[] memory nullifiers = new bytes32[](1);
            nullifiers[0] = nullifier;
            _addPendingTx(noteInputs, nullifiers);
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
            executeVerifier.verify(proof, publicInputs),
            "Invalid execute proof"
        );

        {
            // execute
            RouterERC20 router_ = router; // gas savings
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
            _addPendingTx(noteInputsDyn, nullifiersDyn);
        }
    }

    function rollup(
        bytes calldata proof,
        uint256[] calldata txIndices,
        HeaderLib.AppendOnlyTreeSnapshot calldata newNoteHashTree,
        HeaderLib.AppendOnlyTreeSnapshot calldata newNullifierTree
    ) external {
        Fr[MAX_NOTES_PER_ROLLUP] memory pendingNoteHashes;
        Fr[MAX_NULLIFIERS_PER_ROLLUP] memory pendingNullifiers;
        {
            uint256 noteHashesIdx = 0;
            uint256 nullifiersIdx = 0;
            for (uint256 i = 0; i < txIndices.length; i++) {
                PendingTx memory pendingTx = allPendingTxs[txIndices[i]];
                for (uint256 j = 0; j < pendingTx.noteHashes.length; j++) {
                    pendingNoteHashes[noteHashesIdx++] = pendingTx.noteHashes[
                        j
                    ];
                }
                for (uint256 j = 0; j < pendingTx.nullifiers.length; j++) {
                    pendingNullifiers[nullifiersIdx++] = pendingTx.nullifiers[
                        j
                    ];
                }
            }
        }

        bytes32[] memory publicInputs = new bytes32[](
            (MAX_NOTES_PER_ROLLUP + 4) + (MAX_NULLIFIERS_PER_ROLLUP + 4)
        );
        uint256 p = 0;
        // note hashes
        for (uint256 i = 0; i < pendingNoteHashes.length; i++) {
            publicInputs[p++] = pendingNoteHashes[i].toBytes32();
        }
        publicInputs[p++] = noteHashTree.root;
        publicInputs[p++] = bytes32(
            uint256(noteHashTree.nextAvailableLeafIndex)
        );
        publicInputs[p++] = newNoteHashTree.root;
        publicInputs[p++] = bytes32(
            uint256(newNoteHashTree.nextAvailableLeafIndex)
        );

        // nullifiers
        for (uint256 i = 0; i < pendingNullifiers.length; i++) {
            publicInputs[p++] = pendingNullifiers[i].toBytes32();
        }
        publicInputs[p++] = nullifierTree.root;
        publicInputs[p++] = bytes32(
            uint256(nullifierTree.nextAvailableLeafIndex)
        );
        publicInputs[p++] = newNullifierTree.root;
        publicInputs[p++] = bytes32(
            uint256(newNullifierTree.nextAvailableLeafIndex)
        );
        require(p == publicInputs.length, "Invalid public inputs");
        require(
            rollupVerifier.verify(proof, publicInputs),
            "Invalid rollup proof"
        );

        // mark as rolled up
        for (uint256 i = 0; i < txIndices.length; i++) {
            uint256 txIndex = txIndices[i];
            require(
                !allPendingTxs[txIndex].rolledUp,
                TxAlreadyRolledUp(txIndex)
            );
            allPendingTxs[txIndex].rolledUp = true;
        }

        // state update
        emit NoteHashes(noteHashBatchIndex++, pendingNoteHashes);
        emit Nullifiers(nullifierBatchIndex++, pendingNullifiers);
        noteHashTree = newNoteHashTree;
        nullifierTree = newNullifierTree;
    }

    function _addPendingTx(
        NoteInput[] memory noteInputs,
        bytes32[] memory nullifiers
    ) private {
        require(noteInputs.length <= MAX_NOTES_PER_ROLLUP, "too many notes");
        require(
            nullifiers.length <= MAX_NULLIFIERS_PER_ROLLUP,
            "too many nullifiers"
        );

        allPendingTxs.push();
        PendingTx storage pendingTx = allPendingTxs[allPendingTxs.length - 1];

        for (uint256 i = 0; i < noteInputs.length; i++) {
            Fr noteHash = FrLib.create(noteInputs[i].noteHash);
            require(!noteHashExists[noteHash], NoteHashExists(noteHash));
            noteHashExists[noteHash] = true;
            // TODO(perf): this is a waste of gas
            pendingTx.noteHashes.push(noteHash);
        }

        for (uint256 i = 0; i < nullifiers.length; i++) {
            Fr nullifier = FrLib.create(nullifiers[i]);
            require(!nullifierExists[nullifier], NullifierExists(nullifier));
            nullifierExists[nullifier] = true;
            // TODO(perf): this is a waste of gas
            pendingTx.nullifiers.push(nullifier);
        }

        emit EncryptedNotes(noteInputs);
    }

    function getAllPendingTxs() external view returns (PendingTx[] memory) {
        return allPendingTxs;
    }

    function getNoteHashTree()
        external
        view
        returns (HeaderLib.AppendOnlyTreeSnapshot memory)
    {
        return noteHashTree;
    }

    function getNullifierTree()
        external
        view
        returns (HeaderLib.AppendOnlyTreeSnapshot memory)
    {
        return nullifierTree;
    }
}
