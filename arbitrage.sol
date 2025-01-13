// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPancakeRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract Arbitrage {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    function executeTrade(
        address routerA,
        address routerB,
        address[] calldata path,
        uint amount
    ) external onlyOwner {
        // Approve token transfer for router A
        IERC20(path[0]).approve(routerA, amount);

        // Swap on Router A
        uint[] memory amounts = IPancakeRouter(routerA).swapExactTokensForTokens(
            amount,
            1, // Minimum output
            path,
            address(this),
            block.timestamp + 60
        );

        uint receivedAmount = amounts[amounts.length - 1];

        // Approve token transfer for router B
        IERC20(path[path.length - 1]).approve(routerB, receivedAmount);

        // Swap back on Router B
        IPancakeRouter(routerB).swapExactTokensForTokens(
            receivedAmount,
            1,
            path,
            msg.sender,
            block.timestamp + 60
        );
    }
}
