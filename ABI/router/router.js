const PANCAKESWAP_ROUTER_ABI = require('../price/ArbitrageABI.json');
const BAKERYSWAP_ROUTER_ABI = require('../price/BakerySwapABI.json');
const BISWAP_ROUTER_ABI = require('../price/BiswapABI.json');
const APESWAP_ROUTER_ABI = require('../price/ApeSwapABI.json');
const SUSHISWAP_ROUTER_ABI = require('../price/SushiSwapABI.json');
const MDEX_ROUTER_ABI =require('../price/mdex.json')

const routers = {
    pancakeswap: {
        address: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        abi: PANCAKESWAP_ROUTER_ABI,
        factory: {
            address: '0xca143ce32fe78f1f7019d7d551a6402fc5350c73', // PancakeSwap Factory Address
        }
    },
    sushiswap: {
        address: '0x1b02da8cb0d097eb8d57a175b88c7d8b47997506',
        abi: SUSHISWAP_ROUTER_ABI,
        factory: {
            address: '0xc35dadb65012ec5796536bd9864ed8773abc74c4', // SushiSwap Factory Address
        },
    },
    biswap: {
        address: '0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8',
        abi: BISWAP_ROUTER_ABI,
        factory: {
            address: '0x858E3312ed3A876947EA49d572A7C42DE08af7EE', // biswap Factory Address
        },
    },
    bakeryswap: {
        address: '0xCDe540d7eAFE93aC5fE6233Bee57E1270D3E330F',
        abi: BAKERYSWAP_ROUTER_ABI,
        factory: {
            address: '0x01bF7C66c6BD861915CdaaE475042d3c4BaE16A7', // bakeryswap Factory Address
        },
    },
    apeswap: {
        address: '0xC0788A3aD43d79aa53B09c2EaCc313A787d1d607',
        abi: APESWAP_ROUTER_ABI,
        factory: {
            address: '0x0841BD0B734E4F5853f0dD8d7Ea041c241fb0Da6', // apeswap Factory Address
        },
    },
    babyswap: {
        address: '0x325E343f1dE602396E256B67eFd1F61C3A6B38Bd',
        abi: APESWAP_ROUTER_ABI,
        factory: {
            address: '0x553990F2CBA90272390f62C5BDb1681fFc899675', // apeswap Factory Address
        },
    },
    jetswap: {
        address: '0xBe65b8f75B9F20f4C522e0067a3887FADa714800',
        abi: PANCAKESWAP_ROUTER_ABI,
        factory: {
            address: '0x0eb58E5c8aA63314ff5547289185cC4583DfCBD5', // apeswap Factory Address
        },
    },
    // Add other DEXes similarly
};

module.exports = routers;