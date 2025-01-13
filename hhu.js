require("dotenv").config();
const { ethers } = require("ethers");

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PROVIDER_URL = process.env.PROVIDER_URL;  // Binance Smart Chain
const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";  // PancakeSwap Router
const SUSHI_ROUTER = "0xd9e1f7c11c0d9cfdb3a41b91a907ba7dbd437a8c";  // SushiSwap Router
const BAKERY_ROUTER = "0xC2dD05E6021F77C75550229bdeE9f9d8d6e42dF3";  // BakerySwap Router
const CONTRACT_ADDRESS = "0xYourContractAddress";  // Your smart contract address

const provider = new ethers.providers.JsonRpcProvider(PROVIDER_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contractABI = require("./ArbitrageABI.json");  // Smart contract ABI
const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, wallet);

// List of token addresses (can be dynamic)
const tokenAddresses = [
    "0x...Token1",  // Token A
    "0x...Token2",  // Token B
    "0x...Token3",  // Token C
    // Add more tokens here
];

const SLIPPAGE_TOLERANCE = 0.01; // 1% slippage tolerance
const GAS_ESTIMATION_THRESHOLD = 100000; // Set a reasonable gas limit for the transaction

// Function to get token price from the DEX router
async function getPrice(router, path) {
    const routerContract = new ethers.Contract(router, [
        "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory)"
    ], provider);

    const amountIn = ethers.utils.parseUnits("1", 18); // 1 token
    const amounts = await routerContract.getAmountsOut(amountIn, path);
    return parseFloat(ethers.utils.formatUnits(amounts[1], 18));  // Token B price
}

// Function to estimate gas cost for a transaction
async function estimateGasCost(txData) {
    const estimatedGas = await provider.estimateGas(txData);
    return estimatedGas.toNumber();  // Gas limit in units
}

// Function to get the current gas price from the network and adjust it if necessary
async function getAdjustedGasPrice() {
    // Fetch the current gas price
    let currentGasPrice = await provider.getGasPrice();
    
    // Adjust gas price (e.g., increase by 10% for faster execution during congestion)
    const adjustedGasPrice = currentGasPrice.mul(ethers.BigNumber.from("110")).div(ethers.BigNumber.from("100")); // Increase by 10%
    
    return adjustedGasPrice;
}

// Check for arbitrage opportunities between two tokens
async function findArbitrageOpportunity() {
    for (let i = 0; i < tokenAddresses.length; i++) {
        for (let j = i + 1; j < tokenAddresses.length; j++) {
            const tokenA = tokenAddresses[i];
            const tokenB = tokenAddresses[j];
            
            // Path from Token A → Token B and Token B → Token A
            const pathA = [tokenA, tokenB];
            const pathB = [tokenB, tokenA];

            // Fetch prices from all three DEXs
            const priceA_Pancake = await getPrice(PANCAKE_ROUTER, pathA);
            const priceA_Sushi = await getPrice(SUSHI_ROUTER, pathA);
            const priceA_Bakery = await getPrice(BAKERY_ROUTER, pathA);
            
            const priceB_Pancake = await getPrice(PANCAKE_ROUTER, pathB);
            const priceB_Sushi = await getPrice(SUSHI_ROUTER, pathB);
            const priceB_Bakery = await getPrice(BAKERY_ROUTER, pathB);

            console.log(`Price on PancakeSwap (Token A -> Token B): ${priceA_Pancake}`);
            console.log(`Price on SushiSwap (Token A -> Token B): ${priceA_Sushi}`);
            console.log(`Price on BakerySwap (Token A -> Token B): ${priceA_Bakery}`);

            console.log(`Price on PancakeSwap (Token B -> Token A): ${priceB_Pancake}`);
            console.log(`Price on SushiSwap (Token B -> Token A): ${priceB_Sushi}`);
            console.log(`Price on BakerySwap (Token B -> Token A): ${priceB_Bakery}`);

            // Find arbitrage opportunities by comparing prices on the three DEXs
            const priceA = Math.max(priceA_Pancake, priceA_Sushi, priceA_Bakery);  // Best price for Token A -> Token B
            const priceB = Math.max(priceB_Pancake, priceB_Sushi, priceB_Bakery);  // Best price for Token B -> Token A

            if (priceA > priceB * (1 + SLIPPAGE_TOLERANCE)) {  // Arbitrage opportunity found
                console.log("Arbitrage opportunity found! Calculating gas fees...");

                // Prepare trade data for the best price path (Token A -> Token B)
                const amountIn = ethers.utils.parseUnits("1", 18);  // 1 token
                const amountOutMin = ethers.utils.parseUnits((priceB * (1 + SLIPPAGE_TOLERANCE)).toString(), 18);  // Adjust for slippage

                const txData = {
                    to: PANCAKE_ROUTER,
                    data: contract.interface.encodeFunctionData("executeTrade", [PANCAKE_ROUTER, SUSHI_ROUTER, pathA, amountIn, amountOutMin]),
                };

                // Estimate gas cost
                const estimatedGas = await estimateGasCost(txData);

                // Get the adjusted gas price
                const adjustedGasPrice = await getAdjustedGasPrice();

                // Check if the arbitrage profit exceeds gas fees
                const profit = (priceA - priceB) * 1;  // Example calculation: price difference in tokens (assuming 1 token trade)
                const gasCost = estimatedGas * adjustedGasPrice.toNumber();

                // If the profit after gas costs is greater than 0, proceed with the trade
                if (profit > gasCost) {
                    try {
                        console.log(`Gas limit: ${estimatedGas}, Gas price: ${adjustedGasPrice.toString()}, Profit: ${profit}. Executing trade...`);

                        // Execute the trade with the adjusted gas price and estimated gas limit
                        const tx = await contract.executeTrade(
                            PANCAKE_ROUTER,
                            SUSHI_ROUTER,
                            pathA,
                            amountIn,
                            amountOutMin,
                            {
                                gasLimit: estimatedGas,  // Set the gas limit
                                gasPrice: adjustedGasPrice,  // Set the adjusted gas price
                            }
                        );
                        console.log(`Transaction hash: ${tx.hash}`);
                    } catch (error) {
                        console.error("Error executing trade:", error);
                    }
                } else {
                    console.log("Not profitable after considering gas fees.");
                }
            } else {
                console.log("No arbitrage opportunity found.");
            }
        }
    }
}

// Monitor continuously (every 3 seconds)
setInterval(findArbitrageOpportunity, 3000);