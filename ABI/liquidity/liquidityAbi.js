const FACTORY_ABI = [
    {
        "constant": true,
        "inputs": [
            { "name": "tokenA", "type": "address" },
            { "name": "tokenB", "type": "address" }
        ],
        "name": "getPair",
        "outputs": [{ "name": "pair", "type": "address" }],
        "payable": false,
        "stateMutability": "view",
        "type": "function",
    },
];

const PAIR_ABI = [
    {
        "constant": true,
        "inputs": [],
        "name": "getReserves",
        "outputs": [
            { "name": "reserve0", "type": "uint112" },
            { "name": "reserve1", "type": "uint112" },
            { "name": "blockTimestampLast", "type": "uint32" },
        ],
        "payable": false,
        "stateMutability": "view",
        "type": "function",
    },
    {
        "constant": true,
        "inputs": [],
        "name": "token0",
        "outputs": [{ "name": "", "type": "address" }],
        "payable": false,
        "stateMutability": "view",
        "type": "function",
    },
    {
        "constant": true,
        "inputs": [],
        "name": "token1",
        "outputs": [{ "name": "", "type": "address" }],
        "payable": false,
        "stateMutability": "view",
        "type": "function",
    },
];

module.exports = { FACTORY_ABI, PAIR_ABI };
