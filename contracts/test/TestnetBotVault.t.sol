// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TestnetBotVault} from "../TestnetBotVault.sol";
contract BotMockUSDC is ERC20 {
    constructor() ERC20("USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address a, uint256 n) external { _mint(a, n); }
}
contract TestnetBotVaultTest is Test {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    BotMockUSDC token; TestnetBotVault vault;
    address owner = address(0x123); address session = address(0x456);
    TestnetBotVault.Rules rules;
    function setUp() public {
        vm.chainId(5042002); vm.warp(1800000000);
        BotMockUSDC impl = new BotMockUSDC(); vm.etch(USDC, address(impl).code); token = BotMockUSDC(USDC);
        rules = TestnetBotVault.Rules(bytes32(uint256(1)), 100e6, 50e6, 10e6, 8000, 5, 20, 500);
        vault = new TestnetBotVault(owner, session, rules);
        token.mint(owner, 150e6); vm.startPrank(owner); token.approve(address(vault), 150e6); vault.fund(); vm.stopPrank();
    }
    function trade(bool buy, uint256 price, uint256 seq) internal {
        vm.warp(1800000000 + seq * 60 + 2);
        vm.prank(session); vault.execute(buy, price, 1800000000 + (seq-1)*60, block.timestamp, seq);
    }
    function testBuySellMovesTokensAndRecordsSimulatedProfit() public {
        trade(true, 50000e6, 1);
        assertEq(token.balanceOf(address(vault)), 89990000);
        assertEq(token.balanceOf(address(vault.reserve())), 60010000);
        uint256 btc = vault.getState().btc8; trade(false, 55000e6, 2);
        uint256 gross = btc * (55000e6 * 9995 / 10000) / 1e8;
        uint256 received = gross - gross * 10 / 10000;
        assertEq(vault.getState().cash6, 89990000 + received);
        assertEq(vault.getState().realized6, int256(received) - 10010000);
        assertEq(token.balanceOf(address(vault)) + token.balanceOf(address(vault.reserve())), 150e6);
    }
    function testSessionCannotWithdrawOrChangeSession() public {
        vm.startPrank(session); vm.expectRevert("Owner/testnet only"); vault.close();
        vm.expectRevert("Owner/testnet only"); vault.setSession(address(9)); vm.stopPrank();
    }
    function testWrongNetworkCannotDeployOrTrade() public {
        vm.chainId(5042); vm.expectRevert("Testnet only"); new TestnetBotVault(owner, session, rules);
        vm.prank(session); vm.expectRevert("Session/testnet only"); vault.execute(true, 50000e6, 1800000000, 1800000062, 1);
    }
    function testStaleQuoteAndFutureQuoteRevert() public {
        vm.warp(1800000080); vm.startPrank(session);
        vm.expectRevert("Stale quote"); vault.execute(true, 50000e6, 1800000000, 1800000060, 1);
        vm.expectRevert("Stale quote"); vault.execute(true, 50000e6, 1800000000, 1800000081, 1); vm.stopPrank();
    }
    function testReplayAndSequenceRejected() public {
        trade(true, 50000e6, 1); vm.startPrank(session);
        vm.expectRevert("Sequence"); vault.execute(true, 50000e6, 1800000000, block.timestamp, 1);
        vm.expectRevert("Candle"); vault.execute(true, 50000e6, 1800000000, block.timestamp, 2); vm.stopPrank();
    }
    function testAllocationCap() public {
        for(uint256 i=1;i<=7;i++) trade(true, 50000e6, i);
        vm.warp(1800000482); vm.prank(session); vm.expectRevert("Allocation");
        vault.execute(true, 50000e6, 1800000420, block.timestamp, 8);
    }
    function testReserveExhaustionDoesNotPartiallySettle() public {
        trade(true, 50000e6, 1); vm.warp(1800000122); vm.prank(session); vm.expectRevert("Reserve insufficient");
        vault.execute(false, 1000000e6, 1800000060, block.timestamp, 2);
        assertEq(vault.getState().sequence, 1); assertGt(vault.getState().btc8, 0);
    }
    function testOwnerRecoversAllFundsAfterExpiryWithOpenPosition() public {
        trade(true, 50000e6, 1); vm.warp(1800000000 + 2 days);
        vm.prank(owner); vault.close(); assertEq(token.balanceOf(owner), 150e6);
        assertTrue(vault.getState().closed); assertEq(token.balanceOf(address(vault.reserve())), 0);
    }
    function testSessionRotationRevokesOldSession() public {
        vm.prank(owner); vault.setSession(address(9)); vm.warp(1800000062);
        vm.prank(session); vm.expectRevert("Session/testnet only"); vault.execute(true, 50000e6, 1800000000, block.timestamp, 1);
    }
    function testFundOnceAndNoCrossExperimentAccess() public {
        vm.prank(owner); vm.expectRevert("Unavailable"); vault.fund();
        address pocket = address(vault.reserve());
        vm.prank(session); vm.expectRevert("Controller only"); (bool ok,) = pocket.call(abi.encodeWithSignature("pay(uint256)", 1e6));
        ok;
    }
    function testExpiredSessionCannotTrade() public {
        vm.warp(vault.expiresAt()); vm.prank(session); vm.expectRevert("Inactive");
        vault.execute(true, 50000e6, 1800086340, block.timestamp, 1);
    }
    function testFuzzRoundTripConservesTotalTokens(uint256 price) public {
        price = bound(price, 1000e6, 200000e6);
        trade(true, 50000e6, 1); trade(false, price, 2);
        assertEq(token.balanceOf(address(vault)) + token.balanceOf(address(vault.reserve())), 150e6);
        assertEq(vault.getState().cash6, token.balanceOf(address(vault)));
        vm.prank(owner); vault.close(); assertEq(token.balanceOf(owner), 150e6);
    }
}
