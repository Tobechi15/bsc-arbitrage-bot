const { Web3 } = require('web3');
const ArbitrageExecutorABI = require("../ABI/router/abi.json");

/**
 * Executes an arbitrage trade using the deployed AtomicArbitrageExecutor contract.
 * @param {string} contractAddress - The address of the deployed AtomicArbitrageExecutor contract.
 * @param {string} dex1 - Address of the first DEX router.
 * @param {string} dex2 - Address of the second DEX router.
 * @param {string} tokenIn - The token to swap from.
 * @param {string} tokenOut - The token to swap to.
 * @param {number} amountIn - Amount of tokenIn for the first swap.
 * @param {number} minOutDex1 - Minimum acceptable output for the first swap.
 * @param {number} minOutDex2 - Minimum acceptable output for the second swap.
 * @param {string} walletAddress - The address of the wallet executing the trade.
 * @param {string} privateKey - The private key of the wallet executing the trade.
 */
async function executeArbitrageTrade(
  contractAddress,
  dex1,
  dex2,
  tokenIn,
  tokenOut,
  amountIn,
  minOutDex1,
  minOutDex2,
  walletAddress,
  privateKey
) {
  try {
    const web3 = new Web3("https://your_rpc_url_here"); // Replace with your RPC URL
    const arbitrageContract = new web3.eth.Contract(ArbitrageExecutorABI, contractAddress);

    // Convert amounts to Wei
    const amountInWei = web3.utils.toWei(amountIn.toString(), "ether");
    const minOutDex1Wei = web3.utils.toWei(minOutDex1.toString(), "ether");
    const minOutDex2Wei = web3.utils.toWei(minOutDex2.toString(), "ether");

    // Define token paths for swaps
    const pathDex1 = [tokenIn, tokenOut];
    const pathDex2 = [tokenOut, tokenIn];

    // Prepare ArbitrageParams object
    const arbitrageParams = {
      dex1: dex1,
      dex2: dex2,
      amountIn: amountInWei,
      amountOutMinDex1: minOutDex1Wei,
      amountOutMinDex2: minOutDex2Wei,
      pathDex1: pathDex1,
      pathDex2: pathDex2,
      beneficiary: walletAddress
    };

    // Create the transaction
    const tx = arbitrageContract.methods.executeArbitrage(arbitrageParams);

    // Estimate gas and fetch gas price
    const gas = await tx.estimateGas({ from: walletAddress });
    const gasPrice = await web3.eth.getGasPrice();

    // Prepare transaction data
    const txData = {
      from: walletAddress,
      to: contractAddress,
      gas,
      gasPrice,
      data: tx.encodeABI(),
    };

    // Sign and send the transaction
    const signedTx = await web3.eth.accounts.signTransaction(txData, privateKey);
    const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

    console.log("Transaction successful with hash:", receipt.transactionHash);
    return receipt.transactionHash;
  } catch (error) {
    console.error("Error executing arbitrage trade:", error.message);
    throw error;
  }
}

module.exports = { executeArbitrageTrade };
