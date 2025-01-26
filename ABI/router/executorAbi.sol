// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IDEX {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract AtomicArbitrageExecutor {
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    struct ArbitrageParams {
        address dex1;
        address dex2;
        uint256 amountIn;
        uint256 amountOutMinDex1;
        uint256 amountOutMinDex2;
        address[] pathDex1;
        address[] pathDex2;
        address beneficiary;
    }

    function executeArbitrage(ArbitrageParams calldata params) external onlyOwner {
        // Transfer tokens from the caller to the contract
        require(
            IERC20(params.pathDex1[0]).transferFrom(msg.sender, address(this), params.amountIn),
            "Token transfer failed"
        );

        // Approve the input tokens for dex1
        require(
            IERC20(params.pathDex1[0]).approve(params.dex1, params.amountIn),
            "Token approval for dex1 failed"
        );

        // Execute the first swap on dex1
        uint256[] memory amountsDex1 = IDEX(params.dex1).swapExactTokensForTokens(
            params.amountIn,
            params.amountOutMinDex1,
            params.pathDex1,
            address(this),
            block.timestamp + 300
        );

        uint256 intermediateAmount = amountsDex1[amountsDex1.length - 1];
        require(intermediateAmount > 0, "Trade on dex1 failed");

        // Approve the intermediate tokens for dex2
        require(
            IERC20(params.pathDex2[0]).approve(params.dex2, intermediateAmount),
            "Token approval for dex2 failed"
        );

        // Execute the second swap on dex2
        uint256[] memory amountsDex2 = IDEX(params.dex2).swapExactTokensForTokens(
            intermediateAmount,
            params.amountOutMinDex2,
            params.pathDex2,
            params.beneficiary,
            block.timestamp + 300
        );

        uint256 finalBalance = IERC20(params.pathDex2[params.pathDex2.length - 1]).balanceOf(params.beneficiary);

        // Ensure the arbitrage is profitable
        require(finalBalance > params.amountIn, "Arbitrage not profitable");
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        require(IERC20(token).transfer(owner, amount), "Token withdrawal failed");
    }

    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
}
