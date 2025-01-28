require('dotenv').config();
const { Web3 } = require('web3');
const axios = require("axios");
const fs = require('fs');
const TelegramBot = require("node-telegram-bot-api");
const fetchPotentialTokens = require('./script/fetchPotentialTokens.js'); // Import the fetchPotentialTokens script
const executeArbitrageTrade = require('./script/execute.js');
const Bottleneck = require("bottleneck");
const http = require("http");

// Initialize Web3
const web3 = new Web3(process.env.BSC_NODE_URL);
const walletaddress = process.env.WALLET_ADDRESS;
const privateKey = process.env.PRIVATE_KEY;

const telegramLimiter = new Bottleneck({
  minTime: 33, // 30 messages per second for Telegram
});

const TELEGRAM_BOT_TOKEN = '7315612821:AAEaWJ5I7Os9frU8riAClYr5z2ldA1YmcLc';
const TELEGRAM_CHAT_ID = '935811792';

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Router addresses and ABIs
const routers = require('./ABI/router/router.js');
const { FACTORY_ABI, PAIR_ABI } = require('./ABI/liquidity/liquidityAbi.js');

const appUrl = `https://bsc-arbitrage-bot.onrender.com`; // Replace with your Render app URL
// Set up an HTTP server for port listening
const PORT = 10000; // Use the PORT environment variable or default to 3000

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is running...\n");
}).listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

setInterval(async () => {
  console.log("Attempting to ping the app...");
  try {
    await axios.get(appUrl);
    console.log("Pinged the app to keep it awake.");
  } catch (error) {
    console.error("Error pinging the app:", error.message);
  }
}, 5 * 60 * 1000); // Ping every 5 minutes

async function getWalletBalance(walletAddress) {
  try {
    // Get balance in Wei (BNB's smallest unit)
    const balanceWei = await web3.eth.getBalance(walletAddress);

    // Convert balance from Wei to BNB (1 BNB = 10^18 Wei)
    const balanceBNB = web3.utils.fromWei(balanceWei, 'ether');
    
    console.log(`Wallet balance: ${balanceBNB} BNB`);
    return balanceBNB;
  } catch (error) {
    console.error("Error fetching wallet balance:", error.message);
    throw error;
  }
}
// Function to fetch the current price of a token in BNB and USDT
const getTokenPrices = async (tokenAddress) => {
  try {
    // Fetch token price in BNB
    const bnbResponse = await axios.get(`https://api.coingecko.com/api/v3/simple/token_price/binance-smart-chain?contract_addresses=${tokenAddress}&vs_currencies=bnb`);
    const priceInBNB = bnbResponse.data[tokenAddress.toLowerCase()]?.bnb || 0;

    // Fetch token price in USDT
    const usdtResponse = await axios.get(`https://api.coingecko.com/api/v3/simple/token_price/binance-smart-chain?contract_addresses=${tokenAddress}&vs_currencies=usd`);
    const priceInUSDT = usdtResponse.data[tokenAddress.toLowerCase()]?.usd || 0;

    return { priceInBNB, priceInUSDT };
  } catch (error) {
    console.error("Error fetching token prices:", error.message);
    return { priceInBNB: 0, priceInUSDT: 0 };
  }
};

// Function to get bid and ask prices, and token liquidity
async function getPrice(dexName, tokenAddress, amountInBNB) {
  const { address: routerAddress, abi: routerAbi, factory } = routers[dexName];

  // Initialize Router and Factory Contracts
  const router = new web3.eth.Contract(routerAbi, routerAddress);
  const factoryContract = new web3.eth.Contract(FACTORY_ABI, factory.address);

  const BNB_ADDRESS = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"; // WBNB
  const BID_path = [BNB_ADDRESS, tokenAddress];
  const ASK_path = [tokenAddress, BNB_ADDRESS];

  try {
    // Get Pair Address from Factory
    const pairAddress = await factoryContract.methods
      .getPair(BNB_ADDRESS, tokenAddress).call();

    if (pairAddress === "0x0000000000000000000000000000000000000000") {
      throw new Error(`No liquidity pool found for token ${tokenAddress}`);
    }

    // Initialize Pair Contract
    const pairContract = new web3.eth.Contract(PAIR_ABI, pairAddress);

    // Fetch Reserves
    const reserves = await pairContract.methods.getReserves().call();
    if (!reserves || !reserves.reserve0 || !reserves.reserve1) {
      throw new Error(`Failed to fetch reserves for pair ${pairAddress}`);
    }

    const reserve0 = reserves[0];
    const reserve1 = reserves[1];

    // Determine token order in the pair
    const token0 = await pairContract.methods.token0().call();
    const token1 = await pairContract.methods.token1().call();

    let tokenReserve, bnbReserve;
    if (token0.toLowerCase() === BNB_ADDRESS.toLowerCase()) {
      bnbReserve = reserve0;
      tokenReserve = reserve1;
    } else {
      bnbReserve = reserve1;
      tokenReserve = reserve0;
    }

    // Calculate bid and ask prices
    const BID_amountsOut = await router.methods
      .getAmountsOut(web3.utils.toWei("1", "ether"), BID_path)
      .call();
    const ASK_amountsOut = await router.methods
      .getAmountsOut(web3.utils.toWei("1", "ether"), ASK_path)
      .call();

    const bidPrice = web3.utils.fromWei(BID_amountsOut[1], "ether");
    const askPrice = 1 / web3.utils.fromWei(ASK_amountsOut[1], "ether");

    // Calculate token liquidity
    const tokenLiquidity = web3.utils.fromWei(tokenReserve, "ether");
    const bnbLiquidity = web3.utils.fromWei(bnbReserve, "ether");

    console.log(dexName, 'bid: ', parseFloat(bidPrice), 'ask: ', parseFloat(askPrice), 'token liquidity: ', parseFloat(tokenLiquidity), 'bnb liquidity', parseFloat(bnbLiquidity),)
    return {
      dex: dexName,
      dexADD: routerAddress,
      bid: parseFloat(bidPrice),
      ask: parseFloat(askPrice),
      liquidity: {
        token: parseFloat(tokenLiquidity),
        bnb: parseFloat(bnbLiquidity),
      },
    };
  } catch (error) {
    console.error(`Error fetching data from ${dexName}:`, error.message);
    return null;
  }
}

async function findArbitrageOpportunities(tokensToScan, amountInBNB) {
  const results = [];
  const slippageTolerance = 0.02; // 2% slippage tolerance
  const minLiquidityFactor = 0.1; // Use 10% of available liquidity
  const gasPrice = await web3.eth.getGasPrice(); // Fetch current gas price in wei
  const estimatedGasLimit = 200000; // Estimated gas limit for a trade (adjust as needed)
  const BNB_ADDRESS = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c"; // WBNB

  for (const token of tokensToScan) {
    console.log(`Scanning token: ${token.symbol}`);
    console.log(`Token address: ${token.address}`);

    const prices = [];
    for (const dexName of Object.keys(routers)) {
      const price = await getPrice(dexName, token.address, amountInBNB);
      if (price) {
        prices.push(price);
      }
    }

    let foundOpportunity = false;

    for (const buyExchange of prices) {
      for (const sellExchange of prices) {
        if (buyExchange.dex === sellExchange.dex) continue; // Skip if both exchanges are the same

        // Calculate the tradeable amount based on liquidity constraints
        const maxBuyableBNB = buyExchange.liquidity.bnb * minLiquidityFactor;
        const maxSellableToken = sellExchange.liquidity.token * minLiquidityFactor;
        const tradeableBNB = Math.min(amountInBNB, maxBuyableBNB, maxSellableToken / buyExchange.ask);

        if (tradeableBNB <= 0) {
          console.log(`Tradeable BNB is insufficient for ${token.symbol} between ${buyExchange.dex} and ${sellExchange.dex}.`);
          continue;
        }

        // Simulate the trade
        const tokenReceived = tradeableBNB / buyExchange.ask;
        const bnbReceived = tokenReceived * sellExchange.bid;

        // Calculate the profit
        const profitBNB = bnbReceived - tradeableBNB;
        const gasFee = Number((gasPrice * BigInt(estimatedGasLimit)) / BigInt(1e18)); // Gas fee in BNB
        const slippageCost = tradeableBNB * slippageTolerance;
        const totalFees = gasFee + slippageCost;

        const tolerance = 0.0000146;

        // Check if the profit exceeds fees
        if (profitBNB > totalFees) {
          if ((profitBNB - totalFees) > tolerance) {
            foundOpportunity = true;

            // Calculate profitability in USDT
            const { priceInBNB, priceInUSDT } = await getTokenPrices(token.address);
            const profitUSDT = profitBNB * priceInUSDT;


            // Log the profitable trade
            console.log(`Arbitrage opportunity found for ${token.symbol}!`);
            results.push({
              token: token.symbol,
              buyFrom: buyExchange.dex,
              sellTo: sellExchange.dex,
              buyPrice: buyExchange.ask,
              sellPrice: sellExchange.bid,
              tradeableBNB,
              profitBNB: profitBNB.toFixed(6),
              profitUSDT: profitUSDT.toFixed(6),
              gasFee: gasFee.toFixed(6),
              slippageCost: slippageCost.toFixed(6),
            });

            logTransaction({
              tokenName: token.symbol,
              buyPrice: buyExchange.ask,
              sellPrice: sellExchange.bid,
              fromDex: buyExchange.dex,
              toDex: sellExchange.dex,
              tokenAddress: token.address,
              amountIn: tradeableBNB,
              liquidityBNB: buyExchange.liquidity.bnb,
              liquidityToken: sellExchange.liquidity.token,
              profit: profitBNB.toFixed(6),
              profitUSDT: profitUSDT.toFixed(6),
              gasFee: gasFee.toFixed(6),
              comment: 'Profitable trade found.',
            });

            sendToTelegramme({
              tokenName: token.symbol,
              buyPrice: buyExchange.ask,
              sellPrice: sellExchange.bid,
              fromDex: buyExchange.dex,
              toDex: sellExchange.dex,
              tokenAddress: token.address,
              amountIn: tradeableBNB,
              liquidityBNB: buyExchange.liquidity.bnb,
              liquidityToken: sellExchange.liquidity.token,
              profitBNB: profitBNB.toFixed(6),
              profitUSDT: profitUSDT.toFixed(6),
              gasFee: gasFee.toFixed(6),
              link: token.logoURI,
              comment: 'Profitable trade found.',
              balance: amountInBNB,
            });

            await executeArbitrageTrade(
              contractAddress,
              buyExchange.dexAdd,
              sellExchange.dexADD,
              BNB_ADDRESS,
              token.address, // Assuming it's the same token being traded in both DEXes
              tradeableBNB,
              buyExchange.ask * (1 - slippageTolerance),
              sellExchange.bid * (1 + slippageTolerance),
              walletaddress,
              privateKey
            );
          } else {
            sendToTelegramme({
              tokenName: token.symbol,
              buyPrice: buyExchange.ask,
              sellPrice: sellExchange.bid,
              fromDex: buyExchange.dex,
              toDex: sellExchange.dex,
              tokenAddress: token.address,
              amountIn: tradeableBNB,
              liquidityBNB: buyExchange.liquidity.bnb,
              liquidityToken: sellExchange.liquidity.token,
              profitBNB: profitBNB.toFixed(6),
              profitUSDT: profitUSDT.toFixed(6),
              gasFee: gasFee.toFixed(6),
              link: token.logoURI,
              comment: 'Difference is too small.',
              balance: amountInBNB,
            });
            console.log("Difference is too small.");
          }
        }
      }
    }

    if (!foundOpportunity) {
      console.log(`No arbitrage opportunity for ${token.symbol}.`);
    }
  }

  return results;
}

// Function to log transactions
function logTransaction(transaction) {
  const logEntry = {
    tokenName: transaction.tokenName,
    timestamp: new Date().toISOString(),
    buyPrice: transaction.buyPrice,
    sellPrice: transaction.sellPrice,
    fromDex: transaction.fromDex,
    toDex: transaction.toDex,
    tokenAddress: transaction.tokenAddress,
    amountInBNB: transaction.amountIn,
    liquidityBNB: transaction.liquidityBNB,
    liquidityToken: transaction.liquidityToken,
    profit: transaction?.profit,
    profitBNB: transaction?.profitBNB,
    profitUSDT: transaction?.profitUSDT,
    link: transaction?.link,
    comment: transaction?.comment,
  };

  const filePath = './Logs/transactions.json';
  let logData = [];
  if (fs.existsSync(filePath)) {
    logData = JSON.parse(fs.readFileSync(filePath, 'utf-8') || '[]');
  }
  logData.push(logEntry);
  fs.writeFileSync(filePath, JSON.stringify(logData, null, 2));
}

function logTime(time) {
  const logEntry = {
    fetchTime: time
  };

  const filePath = './Logs/fetchTimeLogs.json';
  let logData = [];
  if (fs.existsSync(filePath)) {
    logData = JSON.parse(fs.readFileSync(filePath, 'utf-8') || '[]');
  }
  logData.push(logEntry);
  fs.writeFileSync(filePath, JSON.stringify(logData, null, 2));
}
async function fetchlastTime() {
  const filePath = './Logs/fetchTimeLogs.json';
  let logData = [];
  if (fs.existsSync(filePath)) {
    logData = JSON.parse(fs.readFileSync(filePath, 'utf-8') || '[]');
  }

  if (logData.length < 0) {
    const logEntry = {
      fetchTime: 0
    };
    logData.push(logEntry);
    fs.writeFileSync(filePath, JSON.stringify(logData, null, 2));
  }

  if (logData.length > 0) {
    const last = logData[logData.length - 1].fetchTime;
    return last;
  }
}

function fetchlastToken() {
  const filePath = './Logs/tokens.json';
  let token = [];
  if (fs.existsSync(filePath)) {
    token = JSON.parse(fs.readFileSync(filePath, 'utf-8') || '[]');
  }
  return token;
}
function logToken(tokens) {
  const filePath = './Logs/tokens.json';
  let logData = tokens;
  fs.writeFileSync(filePath, JSON.stringify(logData, null, 2));
}

const sendToTelegramme = telegramLimiter.wrap(async (transaction) => {
  const message =
    `tokenName: ${transaction.tokenName}\n` +
    `timestamp: ${new Date().toISOString()}\n` +
    `buyPrice: ${transaction.buyPrice}\n` +
    `sellPrice: ${transaction.sellPrice}\n` +
    `fromDex: ${transaction.fromDex}\n` +
    `toDex: ${transaction.toDex}\n` +
    `tokenAddress: ${transaction.tokenAddress}\n` +
    `amountInBNB: ${transaction.amountIn}\n` +
    `liquidityBNB: ${transaction.liquidityBNB}\n` +
    `liquidityToken: ${transaction.liquidityToken}\n` +
    `profit: ${transaction.profit}\n` +
    `profitBNB: ${transaction.profitBNB}\n` +
    `gasfee: ${transaction.gasFee}\n` +
    `profitUSDT: ${transaction.profitUSDT}\n` +
    `comment: ${transaction.comment}\n`+
    `comment: ${transaction.balance}\n`;


  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("Error sending message to Telegram:", err.message);
  }
});

const sendMessageTelegramme = telegramLimiter.wrap(async (message) => {
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("Error sending message to Telegram:", err.message);
  }
})
// Bot loop
async function startBot() {
  let matchedTokens = fetchlastToken(); // Initialize an empty array for tokens
  let lastFetchTime = 0; // Track the last fetch time
  const FETCH_INTERVAL = 24 * 60 * 60 * 1000; // 12 hours in milliseconds
  const telbal = await getWalletBalance(walletaddress);

  const greet = `welcome to Tobechi DEX Screener bot🙋‍♂️ \n` +
    `happy trading👋`+
    `current balance is ${telbal}`;

  sendMessageTelegramme(greet);

  while (true) {
    const currentTime = Date.now();

    // Check if it's time to fetch new tokens
    if (currentTime - lastFetchTime >= FETCH_INTERVAL || matchedTokens.length === 0) {
      console.log("Fetching potential tokens...");
      try {
        matchedTokens = await fetchPotentialTokens(); // Fetch matched tokens
        logToken(matchedTokens);
        lastFetchTime = currentTime; // Update the last fetch time
        const mess = `Fetched ${matchedTokens.length} tokens.`;
        console.log(mess);
        sendMessageTelegramme(mess);
      } catch (error) {
        console.error("Error fetching tokens:", error.message);
      }
    }

    if (matchedTokens.length > 0) {
      try {
        // Process the fetched tokens
        for (const token of matchedTokens) {
          console.log(
            `🔹 *${token.name} (${token.symbol})*\n` +
            `📈 Price Change: ${token.v24hChangePercent.toFixed(2)}%\n` +
            `💧 Liquidity: $${token.liquidity.toLocaleString()}\n` +
            `💵 24H Volume: $${token.v24hUSD.toLocaleString()}\n` +
            `🕒 Last Trade: ${new Date(
              token.lastTradeUnixTime * 1000
            ).toLocaleString()}\n` +
            `🌐 Market Cap: $${token.mc?.toLocaleString()}\n` +
            `[View Token on Explorer](${token.logoURI})\n`
          );
        }

        const amountInBNB = await getWalletBalance(walletaddress); // BNB amount to trade
        console.log("Starting arbitrage scan...");
        await findArbitrageOpportunities(matchedTokens, amountInBNB);
      } catch (error) {
        console.error("Error during bot execution:", error);
      }
    } else {
      console.log("No tokens available for processing.");
    }

    console.log("Waiting for 20 seconds before the next run...");
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}

startBot().catch(error => {
  console.error("Error starting bot:", error);
});