// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockSwap {
    using SafeERC20 for IERC20;

    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountIn,
        uint256 amountOut
    ) external {
        tokenOut.safeTransferFrom(msg.sender, address(this), amountIn);
        tokenIn.safeTransfer(msg.sender, amountOut);
    }
}
