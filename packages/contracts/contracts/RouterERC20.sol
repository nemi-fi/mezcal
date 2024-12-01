// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Call, TokenAmount, MAX_TOKENS_IN_PER_EXECUTION} from "./Utils.sol";

contract RouterERC20 is Ownable(msg.sender) {
    using SafeERC20 for IERC20;
    using Address for address;

    address public pool;

    function initialize(address pool_) external onlyOwner {
        require(pool == address(0), "already initialized");
        pool = pool_;
    }

    function execute(
        Call[] calldata calls,
        TokenAmount[MAX_TOKENS_IN_PER_EXECUTION] calldata amountsIn
    ) external {
        require(msg.sender == pool, "Only pool");
        for (uint256 i = 0; i < calls.length; i++) {
            Call memory call = calls[i];
            // TODO: support sending ETH
            call.to.functionCall(call.data); // TODO(perf): this may be gas optimized if not using openzeppelin
        }

        for (uint256 i = 0; i < amountsIn.length; i++) {
            TokenAmount memory tokenAmount = amountsIn[i];
            if (tokenAmount.amount > 0) {
                tokenAmount.token.safeTransfer(pool, tokenAmount.amount);
            }
        }
    }

    function rescueToken(
        IERC20 token,
        address to,
        uint256 amount
    ) external onlyOwner {
        token.safeTransfer(to, amount);
    }
}
