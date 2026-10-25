// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StrategyLicenseMarket} from "../StrategyLicenseMarket.sol";

/// @dev Fork-free substitute at Arc's reserved USDC interface address; no live chain access.
contract LocalArcUSDC is ERC20 {
    bool public returnFalse;
    bool public callbackAttempted;
    bytes public callbackFailure;
    address private _callbackMarket;
    uint256 private _callbackListing;
    uint256 private _callbackPrice6;
    bytes32 private _callbackDigest;

    constructor() ERC20("Local Arc USDC", "LUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function setReturnFalse(bool enabled) external {
        returnFalse = enabled;
    }

    function setCallback(address market, uint256 listingId, uint256 price6, bytes32 digest) external {
        _callbackMarket = market;
        _callbackListing = listingId;
        _callbackPrice6 = price6;
        _callbackDigest = digest;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (returnFalse) return false;
        if (_callbackMarket != address(0)) {
            callbackAttempted = true;
            (bool success, bytes memory reason) = _callbackMarket.call(
                abi.encodeCall(StrategyLicenseMarket.buyLicense, (_callbackListing, _callbackPrice6, _callbackDigest))
            );
            require(!success, "reentry unexpectedly succeeded");
            callbackFailure = reason;
        }
        return super.transferFrom(from, to, amount);
    }
}

contract StrategyLicenseMarketTest is Test {
    uint256 private constant TESTNET = 5042002;
    uint256 private constant MAINNET = 5042;
    address private constant USDC = 0x3600000000000000000000000000000000000000;
    uint256 private constant PRICE6 = 7_500_000;
    uint256 private constant INITIAL6 = 100_000_000;
    // Precomputed SHA-256 values: avoid a hash-precompile call consuming vm.prank.
    bytes32 private constant STRATEGY = 0x75a9d2040ff46041f3e2d3cfc4b63b8e7ebbcfae29ebf9c38b4234e352b3943f;
    bytes32 private constant REPORT = 0xba8d07e41ff891dce36e38bfc9151c1cbf8a7ea1b0151926d76b231de61f0ac4;
    bytes32 private constant TERMS = 0x2489bea90811db8bf6dc3aa6b33b213c72c721410b4aeaf5f2ebefa6bad1f67d;

    StrategyLicenseMarket private market;
    LocalArcUSDC private token;
    address private seller;
    address private buyer;
    address private outsider;
    uint256 private listingId;

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        bytes32 strategySha256,
        bytes32 reportSha256,
        bytes32 termsSha256,
        uint256 price6,
        string artifactURI,
        string reportURI
    );
    event SalesPauseChanged(uint256 indexed listingId, address indexed seller, bool paused);
    event LicensePurchased(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 paidPrice6,
        bytes32 strategySha256,
        bytes32 reportSha256,
        bytes32 termsSha256
    );

    function setUp() public {
        vm.chainId(TESTNET);
        vm.warp(1_800_000_000);
        LocalArcUSDC implementation = new LocalArcUSDC();
        vm.etch(USDC, address(implementation).code);
        token = LocalArcUSDC(USDC);
        market = new StrategyLicenseMarket(TESTNET);
        seller = makeAddr("seller");
        buyer = makeAddr("buyer");
        outsider = makeAddr("outsider");
        token.mint(buyer, INITIAL6);
        vm.prank(buyer);
        token.approve(address(market), INITIAL6);
        vm.prank(seller);
        listingId = market.createListing(STRATEGY, REPORT, TERMS, PRICE6, "ipfs://artifact-v1", "ipfs://report-v1");
    }

    function testPurchaseTransfersExactPriceAndRecordsEntitlementAndEvent() public {
        vm.expectEmit(true, true, true, true, address(market));
        emit LicensePurchased(listingId, buyer, seller, PRICE6, STRATEGY, REPORT, TERMS);
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        assertEq(token.balanceOf(buyer), INITIAL6 - PRICE6);
        assertEq(token.balanceOf(seller), PRICE6);
        assertEq(token.balanceOf(address(market)), 0);
        assertEq(token.allowance(buyer, address(market)), INITIAL6 - PRICE6);
        assertTrue(market.hasLicense(listingId, buyer));
        (uint256 paidPrice6, uint256 purchasedAt) = market.purchases(listingId, buyer);
        assertEq(paidPrice6, PRICE6);
        assertEq(purchasedAt, block.timestamp);
    }

    function testListingCommitsAllVersionFieldsAndEvent() public {
        vm.expectEmit(true, true, false, true, address(market));
        emit ListingCreated(2, seller, STRATEGY, REPORT, TERMS, PRICE6, "ipfs://artifact-v2", "ipfs://report-v2");
        vm.prank(seller);
        uint256 id = market.createListing(STRATEGY, REPORT, TERMS, PRICE6, "ipfs://artifact-v2", "ipfs://report-v2");
        StrategyLicenseMarket.Listing memory listing = market.getListing(id);
        assertEq(id, 2);
        assertEq(market.nextListingId(), 3);
        assertEq(listing.seller, seller);
        assertEq(listing.strategySha256, STRATEGY);
        assertEq(listing.reportSha256, REPORT);
        assertEq(listing.termsSha256, TERMS);
        assertEq(listing.price6, PRICE6);
        assertEq(listing.artifactURI, "ipfs://artifact-v2");
        assertEq(listing.reportURI, "ipfs://report-v2");
        assertFalse(listing.salesPaused);
    }

    function testDuplicatePurchaseNeverChargesTwiceOrChangesRecord() public {
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        uint256 originalTimestamp = block.timestamp;
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(StrategyLicenseMarket.AlreadyLicensed.selector);
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        assertEq(token.balanceOf(buyer), INITIAL6 - PRICE6);
        assertEq(token.balanceOf(seller), PRICE6);
        (uint256 paidPrice6, uint256 purchasedAt) = market.purchases(listingId, buyer);
        assertEq(paidPrice6, PRICE6);
        assertEq(purchasedAt, originalTimestamp);
    }

    function testSellerCannotPurchaseOwnListing() public {
        vm.expectRevert(StrategyLicenseMarket.SelfPurchase.selector);
        vm.prank(seller);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        assertFalse(market.hasLicense(listingId, seller));
        assertEq(token.balanceOf(seller), 0);
    }

    function testSellerCanPauseNewSalesButCannotRevokePurchasedLicense() public {
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        vm.expectEmit(true, true, false, true, address(market));
        emit SalesPauseChanged(listingId, seller, true);
        vm.prank(seller);
        market.setSalesPaused(listingId, true);
        vm.expectRevert(StrategyLicenseMarket.SalesPaused.selector);
        vm.prank(outsider);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        assertTrue(market.hasLicense(listingId, buyer));
        assertFalse(market.hasLicense(listingId, outsider));
        StrategyLicenseMarket.Listing memory listing = market.getListing(listingId);
        assertTrue(listing.salesPaused);
        assertEq(listing.strategySha256, STRATEGY);
        assertEq(listing.reportSha256, REPORT);
        assertEq(listing.termsSha256, TERMS);
        assertEq(listing.price6, PRICE6);
        assertEq(listing.artifactURI, "ipfs://artifact-v1");
        assertEq(listing.reportURI, "ipfs://report-v1");
    }

    function testSellerCanResumeSales() public {
        vm.startPrank(seller);
        market.setSalesPaused(listingId, true);
        market.setSalesPaused(listingId, false);
        vm.stopPrank();
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        assertTrue(market.hasLicense(listingId, buyer));
    }

    function testOnlySellerCanPauseOrResume() public {
        vm.expectRevert(StrategyLicenseMarket.NotSeller.selector);
        vm.prank(outsider);
        market.setSalesPaused(listingId, true);
        assertFalse(market.getListing(listingId).salesPaused);
        vm.prank(seller);
        market.setSalesPaused(listingId, true);
        vm.expectRevert(StrategyLicenseMarket.NotSeller.selector);
        vm.prank(buyer);
        market.setSalesPaused(listingId, false);
        assertTrue(market.getListing(listingId).salesPaused);
    }

    function testWrongPriceDoesNotChargeOrGrantLicense() public {
        vm.expectRevert(StrategyLicenseMarket.PriceMismatch.selector);
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6 - 1, STRATEGY);
        _assertUnpurchased();
    }

    function testWrongStrategyDigestDoesNotChargeOrGrantLicense() public {
        vm.expectRevert(StrategyLicenseMarket.StrategyMismatch.selector);
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, 0x7a7ff8e2fea99b0969cedeb3bcb0ffc1977631efc8303fa6b95131fd131641a3);
        _assertUnpurchased();
    }

    function testInsufficientAllowanceRollsBackEntirePurchaseAndCanRetry() public {
        vm.prank(buyer);
        token.approve(address(market), PRICE6 - 1);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(market), PRICE6 - 1, PRICE6
            )
        );
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        _assertUnpurchased();
        vm.prank(buyer);
        token.approve(address(market), PRICE6);
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        assertTrue(market.hasLicense(listingId, buyer));
        assertEq(token.balanceOf(seller), PRICE6);
    }

    function testInsufficientBalanceRollsBackRecordAndAllowance() public {
        vm.prank(buyer);
        token.transfer(outsider, INITIAL6);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, buyer, 0, PRICE6));
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        assertFalse(market.hasLicense(listingId, buyer));
        assertEq(token.allowance(buyer, address(market)), INITIAL6);
        assertEq(token.balanceOf(seller), 0);
        (uint256 paidPrice6, uint256 purchasedAt) = market.purchases(listingId, buyer);
        assertEq(paidPrice6, 0);
        assertEq(purchasedAt, 0);
    }

    function testFalseReturningTokenRollsBackEntitlement() public {
        token.setReturnFalse(true);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, USDC));
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        _assertUnpurchased();
    }

    function testTokenCallbackCannotReenterPurchase() public {
        token.setCallback(address(market), listingId, PRICE6, STRATEGY);
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        assertTrue(token.callbackAttempted());
        assertEq(token.callbackFailure(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertTrue(market.hasLicense(listingId, buyer));
        assertFalse(market.hasLicense(listingId, USDC));
        assertEq(token.balanceOf(seller), PRICE6);
        assertEq(token.balanceOf(buyer), INITIAL6 - PRICE6);
    }

    function testRequiresNonzeroStrategyReportAndLicenseTerms() public {
        vm.expectRevert(StrategyLicenseMarket.MissingCommitment.selector);
        market.createListing(bytes32(0), REPORT, TERMS, PRICE6, "ipfs://a", "ipfs://b");
        vm.expectRevert(StrategyLicenseMarket.MissingCommitment.selector);
        market.createListing(STRATEGY, bytes32(0), TERMS, PRICE6, "ipfs://a", "ipfs://b");
        vm.expectRevert(StrategyLicenseMarket.MissingCommitment.selector);
        market.createListing(STRATEGY, REPORT, bytes32(0), PRICE6, "ipfs://a", "ipfs://b");
        assertEq(market.nextListingId(), 2);
    }

    function testRejectsZeroPriceAndEmptyOrOversizedURIs() public {
        vm.expectRevert(StrategyLicenseMarket.InvalidPrice.selector);
        market.createListing(STRATEGY, REPORT, TERMS, 0, "ipfs://a", "ipfs://b");
        vm.expectRevert(StrategyLicenseMarket.InvalidURI.selector);
        market.createListing(STRATEGY, REPORT, TERMS, PRICE6, "", "ipfs://b");
        vm.expectRevert(StrategyLicenseMarket.InvalidURI.selector);
        market.createListing(STRATEGY, REPORT, TERMS, PRICE6, "ipfs://a", "");
        string memory oversized = string(new bytes(2049));
        vm.expectRevert(StrategyLicenseMarket.InvalidURI.selector);
        market.createListing(STRATEGY, REPORT, TERMS, PRICE6, oversized, "ipfs://b");
        vm.expectRevert(StrategyLicenseMarket.InvalidURI.selector);
        market.createListing(STRATEGY, REPORT, TERMS, PRICE6, "ipfs://a", oversized);
    }

    function testUnknownListingsRejectReadPurchaseAndPause() public {
        vm.expectRevert(StrategyLicenseMarket.ListingNotFound.selector);
        market.getListing(0);
        vm.expectRevert(StrategyLicenseMarket.ListingNotFound.selector);
        vm.prank(buyer);
        market.buyLicense(999, PRICE6, STRATEGY);
        vm.expectRevert(StrategyLicenseMarket.ListingNotFound.selector);
        vm.prank(seller);
        market.setSalesPaused(999, true);
        assertFalse(market.hasLicense(999, buyer));
    }

    function testNewVersionDoesNotOverwriteExistingListingOrGrantItsLicense() public {
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        bytes32 version2 = sha256("strategy-version-2");
        vm.prank(seller);
        uint256 next = market.createListing(version2, REPORT, TERMS, PRICE6 * 2, "ipfs://v2", "ipfs://report");
        assertEq(market.getListing(listingId).strategySha256, STRATEGY);
        assertEq(market.getListing(listingId).price6, PRICE6);
        assertEq(market.getListing(next).strategySha256, version2);
        assertTrue(market.hasLicense(listingId, buyer));
        assertFalse(market.hasLicense(next, buyer));
    }

    function testConstructorRejectsUnsupportedOrWrongNetwork() public {
        vm.expectRevert(abi.encodeWithSelector(StrategyLicenseMarket.UnsupportedChain.selector, 1));
        new StrategyLicenseMarket(1);
        vm.expectRevert(abi.encodeWithSelector(StrategyLicenseMarket.WrongChain.selector, MAINNET, TESTNET));
        new StrategyLicenseMarket(MAINNET);
    }

    function testConstructorRejectsWrongUSDCPrecision() public {
        vm.mockCall(USDC, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
        vm.expectRevert(abi.encodeWithSelector(StrategyLicenseMarket.WrongTokenDecimals.selector, uint8(18)));
        new StrategyLicenseMarket(TESTNET);
    }

    function testMainnetConfigurationIsDistinctAndUsesSameERC20Interface() public {
        vm.chainId(MAINNET);
        StrategyLicenseMarket mainnetMarket = new StrategyLicenseMarket(MAINNET);
        assertEq(mainnetMarket.expectedChainId(), MAINNET);
        assertEq(mainnetMarket.USDC(), USDC);
        assertEq(mainnetMarket.USDC_DECIMALS(), 6);
        vm.prank(seller);
        uint256 id = mainnetMarket.createListing(STRATEGY, REPORT, TERMS, PRICE6, "ipfs://a", "ipfs://b");
        vm.prank(buyer);
        token.approve(address(mainnetMarket), PRICE6);
        vm.prank(buyer);
        mainnetMarket.buyLicense(id, PRICE6, STRATEGY);
        assertTrue(mainnetMarket.hasLicense(id, buyer));
        assertFalse(market.hasLicense(listingId, buyer));
        assertEq(token.balanceOf(seller), PRICE6);
    }

    function testWrongNetworkRejectsEveryMutation() public {
        vm.chainId(1);
        bytes memory errorData = abi.encodeWithSelector(StrategyLicenseMarket.WrongChain.selector, TESTNET, 1);
        vm.expectRevert(errorData);
        market.createListing(STRATEGY, REPORT, TERMS, PRICE6, "ipfs://a", "ipfs://b");
        vm.expectRevert(errorData);
        vm.prank(seller);
        market.setSalesPaused(listingId, true);
        vm.expectRevert(errorData);
        vm.prank(buyer);
        market.buyLicense(listingId, PRICE6, STRATEGY);
        _assertUnpurchased();
    }

    function testFuzzPaymentConservesBalancesAndNeverHoldsFunds(uint256 price6) public {
        price6 = bound(price6, 1, INITIAL6);
        vm.prank(seller);
        uint256 id = market.createListing(STRATEGY, REPORT, TERMS, price6, "ipfs://a", "ipfs://b");
        vm.prank(buyer);
        market.buyLicense(id, price6, STRATEGY);
        assertEq(token.balanceOf(buyer), INITIAL6 - price6);
        assertEq(token.balanceOf(seller), price6);
        assertEq(token.balanceOf(address(market)), 0);
        assertEq(token.balanceOf(buyer) + token.balanceOf(seller), INITIAL6);
        (uint256 paidPrice6,) = market.purchases(id, buyer);
        assertEq(paidPrice6, price6);
    }

    function _assertUnpurchased() private view {
        assertFalse(market.hasLicense(listingId, buyer));
        assertEq(token.balanceOf(buyer), INITIAL6);
        assertEq(token.balanceOf(seller), 0);
        assertEq(token.balanceOf(address(market)), 0);
        (uint256 paidPrice6, uint256 purchasedAt) = market.purchases(listingId, buyer);
        assertEq(paidPrice6, 0);
        assertEq(purchasedAt, 0);
    }
}
