const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const Bottleneck = require("bottleneck");

// API and Telegram Bot Configuration
const BIRDEYE_API_URL = "https://public-api.birdeye.so/defi/tokenlist";
const TELEGRAM_BOT_TOKEN = '7315612821:AAEaWJ5I7Os9frU8riAClYr5z2ldA1YmcLc';
const TELEGRAM_CHAT_ID = '935811792';
const API_KEY = "35f0194fdea240bfb702143183d7194a"; // Insert your BirdEye API key here
const API_HEADERS = {
  accept: "application/json",
  "x-chain": "bsc", // Specify BSC as the chain
  "X-API-KEY": API_KEY,
};

// Filtering Criteria
const MIN_LIQUIDITY = 100000; // Minimum liquidity
const MIN_24H_VOLUME = 50000; // Minimum 24-hour volume in USD
const MIN_PRICE_CHANGE = 5; // Minimum 24-hour price change in percentage
const MAX_MARKET_CAP = 500000000; // Maximum market cap for mid-cap tokens
const MAX_TIME_SINCE_TRADE = 3600; // Maximum time since last trade (1 hour)

// Bottlenecker Instances
const apiLimiter = new Bottleneck({
  minTime: 2300, // 1 request per second for API requests
});

const telegramLimiter = new Bottleneck({
  minTime: 33, // 30 messages per second for Telegram
});

// Telegram Bot Instance
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

// Fetch Tokens from BirdEye API with Rate Limiting
const fetchTokens = apiLimiter.wrap(async (offset = 2300, limit = 50) => {
  const params = {
    sort_by: "v24hUSD", // Sort by 24-hour volume in USD
    sort_type: "asc",  // Descending order
    offset: offset,     // Pagination offset
    limit: limit,       // Maximum results per request
    min_liquidity: MIN_LIQUIDITY, // Filter by minimum liquidity
  };

  try {
    const response = await axios.get(BIRDEYE_API_URL, {
      headers: API_HEADERS,
      params,
    });
    return response.data.data.tokens || [];
  } catch (error) {
    console.error("Error fetching tokens:", error.message);
    return [];
  }
});

// Filter Tokens Based on Criteria
const filterTokens = (tokens) => {
  const currentTime = Math.floor(Date.now() / 1000); // Current time in Unix
  return tokens.filter((token) => {
    const priceChange = Math.abs(token.v24hChangePercent);
    const timeSinceLastTrade = currentTime - token.lastTradeUnixTime;

    return (
      token.liquidity >= MIN_LIQUIDITY &&
      token.v24hUSD >= MIN_24H_VOLUME &&
      priceChange >= MIN_PRICE_CHANGE &&
      token.mc <= MAX_MARKET_CAP &&
      timeSinceLastTrade <= MAX_TIME_SINCE_TRADE
    );
  });
};

// Send Filtered Tokens to Telegram with Rate Limiting
const sendToTelegram = telegramLimiter.wrap(async (tokens) => {
  for (const token of tokens) {
    const message =
      `🔹 *${token.name} (${token.symbol})*\n` +
      `📈 Price Change: ${token.v24hChangePercent.toFixed(2)}%\n` +
      `💧 Liquidity: $${token.liquidity.toLocaleString()}\n` +
      `💵 24H Volume: $${token.v24hUSD.toLocaleString()}\n` +
      `🕒 Last Trade: ${new Date(
        token.lastTradeUnixTime * 1000
      ).toLocaleString()}\n` +
      `🌐 Market Cap: $${token.mc?.toLocaleString()}\n` +
      `[View Token on Explorer](${token.logoURI})\n`;

    try {
      await bot.sendMessage(TELEGRAM_CHAT_ID, message, {
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error("Error sending message to Telegram:", err.message);
    }
  }
});

// Main Function with Step-by-Step Logic
const main = async () => {
  let offset = 2300;
  const limit = 50;
  const matchedTokens = []; // Array to store matched tokens

  while (true) {
    console.log(`Fetching tokens from offset: ${offset}`);
    const tokens = await fetchTokens(offset, limit);

    if (tokens.length === 0) {
      console.log("No more tokens to fetch. Exiting...");
      break; // Exit loop if no more tokens
    }

    console.log(`Fetched ${tokens.length} tokens. Filtering...`);
    const filteredTokens = filterTokens(tokens);

    if (filteredTokens.length > 0) {
      console.log(`${filteredTokens.length} tokens matched the criteria. Sending to Telegram...`);
      // for (const token of filteredTokens) {
      //   console.log(
      //     `🔹 *${token.name} (${token.symbol})*\n` +
      //     `📈 Price Change: ${token.v24hChangePercent.toFixed(2)}%\n` +
      //     `💧 Liquidity: $${token.liquidity.toLocaleString()}\n` +
      //     `💵 24H Volume: $${token.v24hUSD.toLocaleString()}\n` +
      //     `🕒 Last Trade: ${new Date(
      //       token.lastTradeUnixTime * 1000
      //     ).toLocaleString()}\n` +
      //     `🌐 Market Cap: $${token.mc?.toLocaleString()}\n` +
      //     `[View Token on Explorer](${token.logoURI})\n`
      //   );
      // }
      await sendToTelegram(filteredTokens); // Wait for Telegram messages to complete
      matchedTokens.push(...filteredTokens); // Add to matchedTokens array
    } else {
      console.log("No tokens met the criteria.");
    }

    offset += limit; // Move to the next batch
  }

  console.log("Matched Tokens:", matchedTokens);
  return matchedTokens;
};

// Execute Script
module.exports = main;