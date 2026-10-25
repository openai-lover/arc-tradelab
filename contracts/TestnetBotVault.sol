// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// A separate, experiment-owned liquidity pocket. No shared funds or external payout recipient.
contract TestnetBotReserve {
    using SafeERC20 for IERC20Metadata;
    address public controller;
    IERC20Metadata constant TOKEN = IERC20Metadata(0x3600000000000000000000000000000000000000);
    constructor() { controller = msg.sender; }
    function pay(uint256 amount) external {
        require(msg.sender == controller && block.chainid == 5042002, "Controller only");
        TOKEN.safeTransfer(controller, amount);
    }
}

/// Test tokens only. BTC, execution prices and SMA signals are client-attested simulations.
/// Each run has its OWN cash and reserve. A session cannot withdraw, change rules or spend
/// another experiment's funds. Closing returns both pockets, not a real trading profit.
contract TestnetBotVault is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;
    IERC20Metadata constant TOKEN = IERC20Metadata(0x3600000000000000000000000000000000000000);
    struct Rules {
        bytes32 strategyHash;
        uint256 budget6;
        uint256 reserve6;
        uint256 order6;
        uint16 allocationBps;
        uint16 shortPeriod;
        uint16 longPeriod;
        uint16 stopLossBps;
    }
    struct State {
        uint256 cash6;
        uint256 btc8;
        uint256 cost6;
        int256 realized6;
        uint256 sequence;
        uint256 lastCandle;
        bool funded;
        bool closed;
    }
    address public owner;
    address public session;
    uint256 public expiresAt;
    uint256 public createdAt;
    uint256 public creationBlock;
    TestnetBotReserve public reserve;
    Rules private rules;
    State private state;
    event Funded(uint256 budget6, uint256 reserve6);
    event SessionChanged(address indexed session);
    event Fill(uint256 indexed sequence, bool buy, uint256 quote6, uint256 execution6, uint256 btc8,
        uint256 transfer6, uint256 fee6, uint256 candle, uint256 observedAt, int256 realized6);
    event Closed(bool positionAbandoned, uint256 returned6);

    constructor(address owner_, address session_, Rules memory rules_) {
        require(block.chainid == 5042002, "Testnet only");
        require(TOKEN.decimals() == 6, "USDC precision");
        require(owner_ != address(0) && session_ != address(0) && owner_ != session_, "Invalid accounts");
        require(rules_.strategyHash != bytes32(0) && rules_.budget6 >= 1e6 && rules_.budget6 <= 1000e6, "Budget/hash");
        require(rules_.reserve6 >= 1e6 && rules_.reserve6 <= 1000e6, "Reserve");
        require(rules_.order6 >= 10000 && rules_.order6 <= rules_.budget6, "Order");
        require(rules_.allocationBps > 0 && rules_.allocationBps <= 10000 && rules_.stopLossBps <= 10000, "Risk limit");
        require(rules_.shortPeriod > 0 && rules_.longPeriod > rules_.shortPeriod && rules_.longPeriod <= 500, "SMA");
        owner = owner_; session = session_; rules = rules_;
        createdAt = block.timestamp; creationBlock = block.number; expiresAt = block.timestamp + 1 days;
        reserve = new TestnetBotReserve();
    }
    modifier onlyOwner() { require(msg.sender == owner && block.chainid == 5042002, "Owner/testnet only"); _; }
    function getRules() external view returns (Rules memory) { return rules; }
    function getState() external view returns (State memory) { return state; }
    function fund() external onlyOwner nonReentrant {
        require(!state.funded && !state.closed && block.timestamp < expiresAt, "Unavailable");
        state.funded = true; state.cash6 = rules.budget6;
        TOKEN.safeTransferFrom(owner, address(this), rules.budget6);
        TOKEN.safeTransferFrom(owner, address(reserve), rules.reserve6);
        emit Funded(rules.budget6, rules.reserve6);
    }
    function setSession(address next) external onlyOwner {
        require(next != address(0) && next != owner && !state.closed && block.timestamp < expiresAt, "Invalid session");
        session = next; emit SessionChanged(next);
    }
    function execute(bool buy, uint256 quote6, uint256 candle, uint256 observedAt, uint256 expectedSequence)
        external nonReentrant
    {
        require(block.chainid == 5042002 && msg.sender == session, "Session/testnet only");
        require(state.funded && !state.closed && block.timestamp < expiresAt && state.sequence < 200, "Inactive");
        require(expectedSequence == state.sequence + 1, "Sequence");
        require(candle % 60 == 0 && candle > state.lastCandle && candle + 60 > createdAt
            && candle + 60 <= block.timestamp && block.timestamp <= candle + 90, "Candle");
        require(observedAt >= candle + 60 && observedAt <= block.timestamp && block.timestamp - observedAt <= 15, "Stale quote");
        require(quote6 >= 1e6 && quote6 <= 10_000_000e6, "Price bounds");
        uint256 execution6 = buy ? quote6 * 10005 / 10000 : quote6 * 9995 / 10000;
        uint256 quantity8; uint256 transfer6; uint256 fee6; int256 pnl;
        if (buy) {
            fee6 = rules.order6 * 10 / 10000;
            transfer6 = rules.order6 + fee6;
            require(transfer6 <= state.cash6 && state.cost6 + transfer6 <= rules.budget6 * rules.allocationBps / 10000, "Allocation");
            quantity8 = rules.order6 * 1e8 / execution6;
            require(quantity8 > 0, "Dust");
            state.cash6 -= transfer6; state.btc8 += quantity8; state.cost6 += transfer6;
            TOKEN.safeTransfer(address(reserve), transfer6);
        } else {
            quantity8 = state.btc8; require(quantity8 > 0, "No position");
            uint256 gross6 = quantity8 * execution6 / 1e8;
            fee6 = gross6 * 10 / 10000; transfer6 = gross6 - fee6;
            require(transfer6 <= TOKEN.balanceOf(address(reserve)), "Reserve insufficient");
            pnl = int256(transfer6) - int256(state.cost6);
            state.cash6 += transfer6; state.realized6 += pnl; state.btc8 = 0; state.cost6 = 0;
            reserve.pay(transfer6);
        }
        state.sequence = expectedSequence; state.lastCandle = candle;
        emit Fill(expectedSequence, buy, quote6, execution6, quantity8, transfer6, fee6, candle, observedAt, pnl);
    }
    /// Always recoverable by the owner, even after expiry, session loss or reserve exhaustion.
    function close() external onlyOwner nonReentrant {
        require(!state.closed, "Closed"); state.closed = true;
        bool abandoned = state.btc8 > 0;
        reserve.pay(TOKEN.balanceOf(address(reserve)));
        uint256 total = TOKEN.balanceOf(address(this));
        TOKEN.safeTransfer(owner, total);
        emit Closed(abandoned, total);
    }
}
