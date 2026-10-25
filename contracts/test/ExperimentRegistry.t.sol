// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ExperimentRegistry} from "../ExperimentRegistry.sol";

/// @dev Local EVM only. These tests never use a wallet, RPC endpoint, or live deployment.
contract ExperimentRegistryTest is Test {
    uint256 private constant TESTNET = 5042002;
    uint64 private constant START = 1_800_000_000;
    bytes32 private constant STRATEGY = bytes32(uint256(1));
    bytes32 private constant POLICY = bytes32(uint256(2));
    bytes32 private constant TERMS = bytes32(uint256(3));
    bytes32 private constant FILL1 = bytes32(uint256(4));
    bytes32 private constant FILL2 = bytes32(uint256(5));
    bytes32 private constant REPORT = bytes32(uint256(6));

    ExperimentRegistry private registry;
    address private owner;
    address private outsider;
    uint256 private experimentId;

    event ExperimentRegistered(
        uint256 indexed experimentId,
        address indexed owner,
        bytes32 strategyFileSha256,
        bytes32 marketPolicyFileSha256,
        bytes32 experimentTermsFileSha256,
        uint64 registeredAt
    );
    event PaperFillAttested(
        uint256 indexed experimentId,
        uint64 indexed sequence,
        address indexed owner,
        bytes32 fillFileSha256,
        uint64 claimedPriceTimestampMs,
        uint64 recordedAt,
        bytes32 previousCommitment,
        bytes32 entryCommitment
    );
    event ExperimentReportSealed(
        uint256 indexed experimentId,
        address indexed owner,
        uint64 entryCount,
        bytes32 lastEntryCommitment,
        bytes32 finalReportFileSha256
    );

    function setUp() public {
        vm.chainId(TESTNET);
        vm.warp(START);
        registry = new ExperimentRegistry();
        owner = makeAddr("experiment owner");
        outsider = makeAddr("other owner");
        vm.prank(owner);
        experimentId = registry.registerExperiment(STRATEGY, POLICY, TERMS);
    }

    function testRegistrationCommitsPolicyTermsAndOwnerWithoutFunds() public view {
        ExperimentRegistry.Experiment memory e = registry.getExperiment(experimentId);
        assertEq(experimentId, 1);
        assertEq(registry.nextExperimentId(), 2);
        assertEq(e.owner, owner);
        assertEq(e.strategyFileSha256, STRATEGY);
        assertEq(e.marketPolicyFileSha256, POLICY);
        assertEq(e.experimentTermsFileSha256, TERMS);
        assertEq(e.registeredAt, START);
        assertEq(e.entryCount, 0);
        assertEq(e.lastEntryCommitment, bytes32(0));
        assertFalse(e.isSealed);
        assertEq(address(registry).balance, 0);
    }

    function testRegistrationEventAndSeparateExperimentLeaveFirstCommitmentIntact() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit ExperimentRegistered(2, outsider, STRATEGY, POLICY, TERMS, START);
        vm.prank(outsider);
        uint256 next = registry.registerExperiment(STRATEGY, POLICY, TERMS);
        assertEq(next, 2);
        assertEq(registry.getExperiment(1).owner, owner);
        assertEq(registry.getExperiment(2).owner, outsider);
    }

    function testMissingInitialCommitmentRevertsWithoutConsumingId() public {
        vm.expectRevert(ExperimentRegistry.MissingCommitment.selector);
        registry.registerExperiment(bytes32(0), POLICY, TERMS);
        vm.expectRevert(ExperimentRegistry.MissingCommitment.selector);
        registry.registerExperiment(STRATEGY, bytes32(0), TERMS);
        vm.expectRevert(ExperimentRegistry.MissingCommitment.selector);
        registry.registerExperiment(STRATEGY, POLICY, bytes32(0));
        assertEq(registry.nextExperimentId(), 2);
    }

    function testAppendStoresClaimedAndRecordedTimesAndDomainSeparatedCommitment() public {
        vm.warp(START + 5);
        uint64 claimed = (START + 4) * 1000 + 250;
        bytes32 expected = _commitment(experimentId, 1, FILL1, claimed, bytes32(0));
        vm.expectEmit(true, true, true, true, address(registry));
        emit PaperFillAttested(experimentId, 1, owner, FILL1, claimed, START + 5, bytes32(0), expected);
        vm.prank(owner);
        registry.attestFill(experimentId, 1, FILL1, claimed, bytes32(0));
        ExperimentRegistry.FillAttestation memory fill = registry.getFill(experimentId, 1);
        assertEq(fill.fillFileSha256, FILL1);
        assertEq(fill.claimedPriceTimestampMs, claimed);
        assertEq(fill.recordedAt, START + 5);
        assertEq(fill.entryCommitment, expected);
        assertTrue(registry.recordedFillDigests(experimentId, FILL1));
        assertEq(registry.getExperiment(experimentId).lastEntryCommitment, expected);
        assertEq(registry.getExperiment(experimentId).entryCount, 1);
    }

    function testSequentialAppendLinksPredecessorAndNeverChangesEarlierFill() public {
        _appendFirst();
        bytes32 first = registry.getFill(experimentId, 1).entryCommitment;
        vm.warp(START + 1);
        uint64 claimed = (START + 1) * 1000;
        vm.prank(owner);
        registry.attestFill(experimentId, 2, FILL2, claimed, first);
        assertEq(registry.getFill(experimentId, 1).entryCommitment, first);
        assertEq(registry.getFill(experimentId, 2).entryCommitment, _commitment(experimentId, 2, FILL2, claimed, first));
        assertEq(registry.getExperiment(experimentId).entryCount, 2);
        assertEq(registry.getExperiment(experimentId).strategyFileSha256, STRATEGY);
    }

    function testOnlyOwnerCanAppendOrSeal() public {
        vm.expectRevert(ExperimentRegistry.NotExperimentOwner.selector);
        vm.prank(outsider);
        registry.attestFill(experimentId, 1, FILL1, START * 1000, bytes32(0));
        vm.expectRevert(ExperimentRegistry.NotExperimentOwner.selector);
        vm.prank(outsider);
        registry.sealExperiment(experimentId, 0, bytes32(0), REPORT);
        assertEq(registry.getExperiment(experimentId).entryCount, 0);
    }

    function testStaleSequenceAndWrongPredecessorCannotOverwriteOrAppend() public {
        _appendFirst();
        bytes32 first = registry.getFill(experimentId, 1).entryCommitment;
        vm.expectRevert(ExperimentRegistry.SequenceMismatch.selector);
        vm.prank(owner);
        registry.attestFill(experimentId, 1, FILL2, START * 1000, bytes32(0));
        vm.expectRevert(ExperimentRegistry.SequenceMismatch.selector);
        vm.prank(owner);
        registry.attestFill(experimentId, 3, FILL2, START * 1000, first);
        vm.expectRevert(ExperimentRegistry.PreviousCommitmentMismatch.selector);
        vm.prank(owner);
        registry.attestFill(experimentId, 2, FILL2, START * 1000, bytes32(0));
        assertEq(registry.getExperiment(experimentId).entryCount, 1);
        assertEq(registry.getFill(experimentId, 1).fillFileSha256, FILL1);
    }

    function testDuplicateDigestWithinExperimentRejectedButIndependentExperimentAllowed() public {
        _appendFirst();
        bytes32 first = registry.getFill(experimentId, 1).entryCommitment;
        vm.expectRevert(ExperimentRegistry.DuplicateFillDigest.selector);
        vm.prank(owner);
        registry.attestFill(experimentId, 2, FILL1, START * 1000, first);
        vm.prank(owner);
        uint256 other = registry.registerExperiment(STRATEGY, POLICY, TERMS);
        vm.prank(owner);
        registry.attestFill(other, 1, FILL1, START * 1000, bytes32(0));
        assertTrue(registry.recordedFillDigests(other, FILL1));
        assertTrue(registry.recordedFillDigests(experimentId, FILL1));
        assertNotEq(registry.getFill(other, 1).entryCommitment, first);
    }

    function testMissingFillDigestDoesNotMutateExperiment() public {
        vm.expectRevert(ExperimentRegistry.MissingCommitment.selector);
        vm.prank(owner);
        registry.attestFill(experimentId, 1, bytes32(0), START * 1000, bytes32(0));
        assertEq(registry.getExperiment(experimentId).entryCount, 0);
    }

    function testClaimedTimestampMustNotPredateRegistrationOrBeInFuture() public {
        vm.expectRevert(ExperimentRegistry.InvalidClaimedPriceTimestamp.selector);
        vm.prank(owner);
        registry.attestFill(experimentId, 1, FILL1, START * 1000 - 1, bytes32(0));
        vm.expectRevert(ExperimentRegistry.InvalidClaimedPriceTimestamp.selector);
        vm.prank(owner);
        registry.attestFill(experimentId, 1, FILL1, (START + 1) * 1000, bytes32(0));
        vm.prank(owner);
        registry.attestFill(experimentId, 1, FILL1, START * 1000 + 999, bytes32(0));
        assertEq(registry.getExperiment(experimentId).entryCount, 1);
    }

    function testClaimedPriceTimesCannotMoveBackwardButEqualTimestampIsAllowed() public {
        vm.warp(START + 5);
        uint64 claimed = (START + 4) * 1000;
        vm.prank(owner);
        registry.attestFill(experimentId, 1, FILL1, claimed, bytes32(0));
        bytes32 first = registry.getFill(experimentId, 1).entryCommitment;
        vm.expectRevert(ExperimentRegistry.InvalidClaimedPriceTimestamp.selector);
        vm.prank(owner);
        registry.attestFill(experimentId, 2, FILL2, claimed - 1, first);
        vm.prank(owner);
        registry.attestFill(experimentId, 2, FILL2, claimed, first);
        assertEq(registry.getExperiment(experimentId).lastClaimedPriceTimestampMs, claimed);
    }

    function testSealingCommitsReportAndPermanentlyRejectsFurtherChanges() public {
        _appendFirst();
        bytes32 first = registry.getFill(experimentId, 1).entryCommitment;
        vm.expectEmit(true, true, false, true, address(registry));
        emit ExperimentReportSealed(experimentId, owner, 1, first, REPORT);
        vm.prank(owner);
        registry.sealExperiment(experimentId, 1, first, REPORT);
        assertTrue(registry.getExperiment(experimentId).isSealed);
        assertEq(registry.getExperiment(experimentId).finalReportFileSha256, REPORT);
        vm.expectRevert(ExperimentRegistry.ExperimentSealed.selector);
        vm.prank(owner);
        registry.attestFill(experimentId, 2, FILL2, START * 1000, first);
        vm.expectRevert(ExperimentRegistry.ExperimentSealed.selector);
        vm.prank(owner);
        registry.sealExperiment(experimentId, 1, first, FILL2);
        assertEq(registry.getExperiment(experimentId).finalReportFileSha256, REPORT);
    }

    function testSealChecksCountPredecessorAndNonzeroReportDigest() public {
        vm.expectRevert(ExperimentRegistry.EntryCountMismatch.selector);
        vm.prank(owner);
        registry.sealExperiment(experimentId, 1, bytes32(0), REPORT);
        vm.expectRevert(ExperimentRegistry.PreviousCommitmentMismatch.selector);
        vm.prank(owner);
        registry.sealExperiment(experimentId, 0, FILL1, REPORT);
        vm.expectRevert(ExperimentRegistry.MissingCommitment.selector);
        vm.prank(owner);
        registry.sealExperiment(experimentId, 0, bytes32(0), bytes32(0));
        assertFalse(registry.getExperiment(experimentId).isSealed);
    }

    function testNoTradeExperimentCanBeSealedWithoutInventingAFill() public {
        vm.prank(owner);
        registry.sealExperiment(experimentId, 0, bytes32(0), REPORT);
        assertTrue(registry.getExperiment(experimentId).isSealed);
        assertEq(registry.getExperiment(experimentId).entryCount, 0);
    }

    function testUnknownExperimentsAndFillsRejectReadsAndMutations() public {
        vm.expectRevert(ExperimentRegistry.ExperimentNotFound.selector);
        registry.getExperiment(0);
        vm.expectRevert(ExperimentRegistry.FillNotFound.selector);
        registry.getFill(experimentId, 0);
        vm.expectRevert(ExperimentRegistry.FillNotFound.selector);
        registry.getFill(experimentId, 1);
        vm.expectRevert(ExperimentRegistry.ExperimentNotFound.selector);
        registry.attestFill(999, 1, FILL1, START * 1000, bytes32(0));
        vm.expectRevert(ExperimentRegistry.ExperimentNotFound.selector);
        registry.sealExperiment(999, 0, bytes32(0), REPORT);
    }

    function testMainnetDeploymentAndEveryWrongChainMutationAreRejected() public {
        vm.chainId(5042);
        vm.expectRevert(abi.encodeWithSelector(ExperimentRegistry.WrongChain.selector, 5042));
        new ExperimentRegistry();
        bytes memory wrong = abi.encodeWithSelector(ExperimentRegistry.WrongChain.selector, 5042);
        vm.expectRevert(wrong);
        registry.registerExperiment(STRATEGY, POLICY, TERMS);
        vm.expectRevert(wrong);
        vm.prank(owner);
        registry.attestFill(experimentId, 1, FILL1, START * 1000, bytes32(0));
        vm.expectRevert(wrong);
        vm.prank(owner);
        registry.sealExperiment(experimentId, 0, bytes32(0), REPORT);
        assertEq(registry.getExperiment(experimentId).entryCount, 0);
    }

    function testRegistryRejectsNativeValueAndHasNoCustodyOperation() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        (bool received,) = address(registry).call{value: 1}("");
        assertFalse(received);
        vm.prank(owner);
        (bool payableRegistration,) = address(registry).call{value: 1}(
            abi.encodeCall(ExperimentRegistry.registerExperiment, (STRATEGY, POLICY, TERMS))
        );
        assertFalse(payableRegistration);
        assertEq(address(registry).balance, 0);
        assertEq(owner.balance, 1 ether);
        assertEq(registry.nextExperimentId(), 2);
    }

    function testFuzzDigestCommitmentDoesNotChangeInitialPolicy(bytes32 digest, uint64 delayMs) public {
        vm.assume(digest != bytes32(0));
        delayMs = uint64(bound(delayMs, 0, 86_399_999));
        vm.warp(START + 1 days);
        uint64 claimed = START * 1000 + delayMs;
        vm.prank(owner);
        registry.attestFill(experimentId, 1, digest, claimed, bytes32(0));
        ExperimentRegistry.Experiment memory e = registry.getExperiment(experimentId);
        assertEq(e.strategyFileSha256, STRATEGY);
        assertEq(e.marketPolicyFileSha256, POLICY);
        assertEq(e.experimentTermsFileSha256, TERMS);
        assertEq(registry.getFill(experimentId, 1).fillFileSha256, digest);
        assertEq(e.lastEntryCommitment, _commitment(experimentId, 1, digest, claimed, bytes32(0)));
        assertEq(address(registry).balance, 0);
    }

    function _appendFirst() private {
        vm.prank(owner);
        registry.attestFill(experimentId, 1, FILL1, START * 1000, bytes32(0));
    }

    function _commitment(uint256 id, uint64 sequence, bytes32 digest, uint64 claimed, bytes32 previous)
        private
        view
        returns (bytes32)
    {
        return
            keccak256(abi.encode(TESTNET, address(registry), id, sequence, owner, STRATEGY, digest, claimed, previous));
    }
}
