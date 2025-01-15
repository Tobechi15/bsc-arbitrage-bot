require('dotenv').config();
const { Web3 } = require('web3');
const axios = require("axios");
const fs = require('fs');
const TelegramBot = require("node-telegram-bot-api");
const fetchPotentialTokens = require('./script/fetchPotentialTokens.js'); // Import the fetchPotentialTokens script
const Bottleneck = require("bottleneck");
const http = require("http");

// Initialize Web3
const web3 = new Web3(process.env.BSC_NODE_URL);
const walletaddress = process.env.WALLET_ADDRESS;

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
}, 15 * 60 * 1000); // Ping every 5 minutes

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
      .getAmountsOut(web3.utils.toWei(amountInBNB.toString(), "ether"), BID_path)
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

// Main arbitrage logic
async function findArbitrageOpportunities(tokensToScan, amountInBNB) {
  const results = [];
  const slippageTolerance = 0.02; // 2% slippage tolerance
  const minLiquidityFactor = 100; // Minimum liquidity factor
  console.log(`yeet`);
  const gasPrice = await web3.eth.getGasPrice(); // Fetch current gas price in wei
  const estimatedGasLimit = 200000; // Estimated gas limit for a trade (adjust as needed)

  for (const token of tokensToScan) {
    console.log(`Scanning token: ${token.symbol}`);
    console.log(`Token address: ${token.address}`);

    // Fetch token prices from all DEXs
    const prices = [];
    for (const dexName of Object.keys(routers)) {
      const price = await getPrice(dexName, token.address, amountInBNB);
      if (price) {
        prices.push(price);
      }
    }

    // Find the lowest ask and highest bid across all DEXs
    const lowestAsk = prices.reduce((min, p) => (p.ask < min.ask ? p : min), prices[0]);
    const highestBid = prices.reduce((max, p) => (p.bid > max.bid ? p : max), prices[0]);

    // Ensure there is an arbitrage opportunity
    if (lowestAsk && highestBid && highestBid.bid > lowestAsk.ask) {
      // Liquidity Check
      if (
        lowestAsk.liquidity.token < amountInBNB * minLiquidityFactor ||
        lowestAsk.liquidity.bnb < amountInBNB * minLiquidityFactor
      ) {
        console.log(`Insufficient liquidity for ${token.symbol} on ${lowestAsk.dex}.`);
        logTransaction({
          tokenName: token.symbol,
          buyPrice: lowestAsk.ask,
          sellPrice: highestBid.bid,
          fromDex: lowestAsk.dex,
          toDex: highestBid.dex,
          tokenAddress: token.address,
          amountIn: amountInBNB,
          liquidityBNB: lowestAsk.liquidity.bnb,
          liquidityToken: lowestAsk.liquidity.token,
          comment: `Insufficient liquidity for ${token.symbol} on ${lowestAsk.dex}.`
        });
        sendToTelegramme({
          tokenName: token.symbol,
          buyPrice: lowestAsk.ask,
          sellPrice: highestBid.bid,
          fromDex: lowestAsk.dex,
          toDex: highestBid.dex,
          tokenAddress: token.address,
          amountIn: amountInBNB,
          liquidityBNB: lowestAsk.liquidity.bnb,
          liquidityToken: lowestAsk.liquidity.token,
          comment: `Insufficient liquidity for ${token.symbol} on ${lowestAsk.dex}.`,
        });
        continue;
      }

      // Price Impact and Slippage Check
      const priceImpact = (amountInBNB / lowestAsk.liquidity.token) * 100;
      if (priceImpact > slippageTolerance * 100) {
        console.log(`High slippage for ${token.symbol} on ${lowestAsk.dex}.`);
        logTransaction({
          tokenName: token.symbol,
          buyPrice: lowestAsk.ask,
          sellPrice: highestBid.bid,
          fromDex: lowestAsk.dex,
          toDex: highestBid.dex,
          tokenAddress: token.address,
          amountIn: amountInBNB,
          liquidityBNB: lowestAsk.liquidity.bnb,
          liquidityToken: lowestAsk.liquidity.token,
          comment: `High slippage for ${token.symbol} on ${lowestAsk.dex}.`

        });
        sendToTelegramme({
          tokenName: token.symbol,
          buyPrice: lowestAsk.ask,
          sellPrice: highestBid.bid,
          fromDex: lowestAsk.dex,
          toDex: highestBid.dex,
          tokenAddress: token.address,
          amountIn: amountInBNB,
          liquidityBNB: lowestAsk.liquidity.bnb,
          liquidityToken: lowestAsk.liquidity.token,
          comment: `High slippage for ${token.symbol} on ${lowestAsk.dex}.`,
        });
        continue;
      }

      // Fetch the token price in BNB and USDT
      const { priceInBNB, priceInUSDT } = await getTokenPrices(token.address);

      // Calculate Profitability
      const profit = (highestBid.bid - lowestAsk.ask) * amountInBNB;
      const gasFee = (gasPrice * estimatedGasLimit) / 1e18; // Convert wei to BNB
      const profitBNB = profit * priceInBNB;
      const profitUSDT = profit * priceInUSDT;

      // Ensure profit is greater than transaction costs
      const transactionCost = gasFee + (priceImpact * amountInBNB);
      if (profit <= transactionCost) {
        console.log(`Low profitability for ${token.symbol}.`);
        logTransaction({
          tokenName: token.symbol,
          buyPrice: lowestAsk.ask,
          sellPrice: highestBid.bid,
          fromDex: lowestAsk.dex,
          toDex: highestBid.dex,
          tokenAddress: token.address,
          amountIn: amountInBNB,
          liquidityBNB: lowestAsk.liquidity.bnb,
          liquidityToken: lowestAsk.liquidity.token,
          comment: `Low profitability for ${token.symbol}.`
        });
        sendToTelegramme({
          tokenName: token.symbol,
          buyPrice: lowestAsk.ask,
          sellPrice: highestBid.bid,
          fromDex: lowestAsk.dex,
          toDex: highestBid.dex,
          tokenAddress: token.address,
          amountIn: amountInBNB,
          liquidityBNB: lowestAsk.liquidity.bnb,
          liquidityToken: lowestAsk.liquidity.token,
          profit,
          profitBNB,
          profitUSDT,
          gasFee,
          comment: `Low profitability for ${token.symbol}.`
        });
        continue;
      }

      // Log and report the arbitrage opportunity
      console.log(`Arbitrage opportunity found for ${token.symbol}!`);
      results.push({
        token: token.symbol,
        buyFrom: lowestAsk.dex,
        sellTo: highestBid.dex,
        buyPrice: lowestAsk.ask,
        sellPrice: highestBid.bid,
        profit: profit.toFixed(6),
        profitBNB,
        profitUSDT,
        gasFee,
      });

      logTransaction({
        tokenName: token.symbol,
        buyPrice: lowestAsk.ask,
        sellPrice: highestBid.bid,
        fromDex: lowestAsk.dex,
        toDex: highestBid.dex,
        tokenAddress: token.address,
        amountIn: amountInBNB,
        liquidityBNB: lowestAsk.liquidity.bnb,
        liquidityToken: lowestAsk.liquidity.token,
        profit,
        profitBNB,
        profitUSDT,
        gasFee,
        comment: 'profit',
      });

      sendToTelegramme({
        tokenName: token.symbol,
        buyPrice: lowestAsk.ask,
        sellPrice: highestBid.bid,
        fromDex: lowestAsk.dex,
        toDex: highestBid.dex,
        tokenAddress: token.address,
        amountIn: amountInBNB,
        liquidityBNB: lowestAsk.liquidity.bnb,
        liquidityToken: lowestAsk.liquidity.token,
        profit,
        profitBNB,
        profitUSDT,
        gasFee,
        comment: 'profit',
      });
    } else {
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
    `profitUSDT: ${transaction.profitUSDT}\n` +
    `comment: ${transaction.comment}\n`;

  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("Error sending message to Telegram:", err.message);
  }
});

// Bot loop
async function startBot() {
  let matchedTokens = fetchlastToken(); // Initialize an empty array for tokens
  let lastFetchTime = await fetchlastTime(); // Track the last fetch time
  const FETCH_INTERVAL = 24 * 60 * 60 * 1000; // 12 hours in milliseconds

  while (true) {
    const currentTime = Date.now();

    // Check if it's time to fetch new tokens
    if (currentTime - lastFetchTime >= FETCH_INTERVAL || matchedTokens.length === 0) {
      console.log("Fetching potential tokens...");
      try {
        matchedTokens = await fetchPotentialTokens(); // Fetch matched tokens
        logToken(matchedTokens);
        lastFetchTime = logTime(currentTime); // Update the last fetch time
        console.log(`Fetched ${matchedTokens.length} tokens.`);
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

        const amountInBNB = 1; // BNB amount to trade
        console.log("Starting arbitrage scan...");
        await findArbitrageOpportunities(matchedTokens, amountInBNB);
      } catch (error) {
        console.error("Error during bot execution:", error);
      }
    } else {
      console.log("No tokens available for processing.");
    }

    console.log("Waiting for 20 seconds before the next run...");
    await new Promise(resolve => setTimeout(resolve, 20000));
  }
}

startBot().catch(error => {
  console.error("Error starting bot:", error);
});