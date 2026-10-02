// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {WorldTokenBSCV2} from "../src/WorldTokenBSCV2.sol";
import {WorldCoreBSCV2} from "../src/WorldCoreBSCV2.sol";
import {WorldDeploymentBSCV2} from "../src/WorldDeploymentBSCV2.sol";

/// @dev Permission fixture only. It deliberately has no sale or economic logic.
contract TokenPermissionCoreFixtureV2 {
    function mint(WorldTokenBSCV2 token, address to, uint256 amount) external {
        token.mint(to, amount);
    }

    function burnFrom(WorldTokenBSCV2 token, address from, uint256 amount) external {
        token.burnFrom(from, amount);
    }

    function burnThenFail(WorldTokenBSCV2 token, address from, uint256 amount) external {
        token.burnFrom(from, amount);
        revert("local post-burn failure");
    }
}

/// @dev These cases run the actual factory, Core and Token together; no permission fixture minting.
contract WorldTokenBSCV2IntegrationTest is Test {
    WorldDeploymentBSCV2 private factory;
    WorldTokenBSCV2 private token;
    WorldCoreBSCV2 private core;
    address private alice = makeAddr("integration alice");
    address private bob = makeAddr("integration bob");

    function setUp() public {
        factory = new WorldDeploymentBSCV2();
        token = factory.token();
        core = factory.core();
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        _buy(alice, 100 ether);
        _buy(bob, 100 ether);
    }

    function _buy(address who, uint256 amount) private {
        uint256 cost = core.quoteBuy(amount);
        vm.prank(who);
        core.buyWorld{value: cost}(amount, who);
    }

    function test_ActualWarConsumesCallerFiniteApprovalAndBurnsWithoutInventory() public {
        vm.prank(alice);
        token.approve(address(core), 25 ether);
        vm.prank(alice);
        assertTrue(core.attack(1, 0, 20 ether));
        assertEq(token.allowance(alice, address(core)), 5 ether);
        assertEq(token.balanceOf(alice), 80 ether);
        assertEq(token.totalSupply(), 180 ether);
        assertEq(token.balanceOf(address(core)), 0);
        vm.prank(bob);
        token.approve(address(core), type(uint256).max);
        vm.prank(bob);
        core.defend(1, 1, 3 ether);
        assertEq(token.balanceOf(bob), 97 ether);
        assertEq(token.allowance(bob, address(core)), type(uint256).max);
        assertEq(token.totalSupply(), 177 ether);
        assertEq(token.balanceOf(address(core)), 0);
        assertEq(core.currentResistanceRaw(1), 23 ether << 64);
    }

    function test_HolderSelfBurnDoesNotChangeWorldAccountingOrMintRewards() public {
        vm.prank(alice);
        token.approve(address(core), 20 ether);
        vm.prank(alice);
        core.attack(1, 0, 20 ether);
        vm.warp(block.timestamp + 7 days);
        (address owner, uint256 raw, uint64 anchor, uint256 epoch, uint256 j) = core.lands(1);
        bytes32 before_ = keccak256(abi.encode(owner, raw, anchor, epoch, j));
        uint256 bnbBefore = alice.balance;
        uint256 treasuryBefore = address(core).balance;
        uint256 accountedBefore = core.accountedBNB();
        uint256 claimBefore = core.claimable(alice);
        vm.prank(alice);
        token.burn(80 ether);
        (owner, raw, anchor, epoch, j) = core.lands(1);
        assertEq(keccak256(abi.encode(owner, raw, anchor, epoch, j)), before_);
        assertEq(alice.balance, bnbBefore);
        assertEq(address(core).balance, treasuryBefore);
        assertEq(core.accountedBNB(), accountedBefore);
        assertEq(core.claimable(alice), claimBefore);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.totalSupply(), 100 ether);
    }

    function test_FullSupplyBurnThenFreshPaidMintAndWar() public {
        vm.prank(alice);
        token.approve(address(core), type(uint256).max);
        vm.prank(alice);
        core.attack(50, 0, 100 ether);
        vm.prank(bob);
        token.burn(100 ether);
        assertEq(token.totalSupply(), 0);
        assertEq(core.currentResistanceRaw(50), 100 ether << 64);
        _buy(bob, 101 ether);
        vm.prank(bob);
        token.approve(address(core), 101 ether);
        vm.prank(bob);
        assertTrue(core.attack(50, 1, 101 ether));
        assertEq(token.totalSupply(), 0);
        (address owner, uint256 raw,, uint256 epoch,) = core.lands(50);
        assertEq(owner, bob);
        assertEq(raw, 1 ether << 64);
        assertEq(epoch, 2);
    }

    function test_ActualWarFailedAuthorizationLeavesSupplyLandAndBNBUntouched() public {
        uint256 accountedBefore = core.accountedBNB();
        uint256 bnbBefore = address(core).balance;
        vm.expectRevert();
        vm.prank(alice);
        core.attack(7, 0, 1 ether);
        assertEq(token.totalSupply(), 200 ether);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.allowance(alice, address(core)), 0);
        assertEq(core.accountedBNB(), accountedBefore);
        assertEq(address(core).balance, bnbBefore);
        (address owner, uint256 raw, uint64 anchor, uint256 epoch, uint256 j) = core.lands(7);
        assertEq(owner, address(0));
        assertEq(raw, 0);
        assertEq(anchor, 0);
        assertEq(epoch, 0);
        assertEq(j, 0);
        assertEq(core.claimable(alice), 0);
    }
}

contract UnauthorizedCallerV2 {
    function mint(WorldTokenBSCV2 token, address to, uint256 amount) external {
        token.mint(to, amount);
    }
}

/// @dev A transfer or mint must not invoke an arbitrary recipient callback.
contract RejectAllCallsV2 {
    fallback() external {
        revert("unexpected token callback");
    }
}

contract WorldTokenBSCV2Test is Test {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    WorldTokenBSCV2 internal token;
    TokenPermissionCoreFixtureV2 internal core;
    UnauthorizedCallerV2 internal unauthorized;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal spender = makeAddr("spender");

    function setUp() public {
        core = new TokenPermissionCoreFixtureV2();
        unauthorized = new UnauthorizedCallerV2();
        token = new WorldTokenBSCV2(address(core));
    }

    function test_DeploymentHasZeroSupplyAndExpectedMetadata() public view {
        assertEq(token.name(), "WORLD");
        assertEq(token.symbol(), "WORLD");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.balanceOf(address(core)), 0);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.core(), address(core));
    }

    function test_HolderBurnReducesOnlyOwnBalanceAndSupply() public {
        core.mint(token, alice, 11 ether);
        core.mint(token, bob, 3 ether);
        uint256 bnbBefore = alice.balance;
        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(alice, address(0), 7 ether);
        vm.prank(alice);
        token.burn(7 ether);
        assertEq(token.balanceOf(alice), 4 ether);
        assertEq(token.balanceOf(bob), 3 ether);
        assertEq(token.totalSupply(), 7 ether);
        assertEq(alice.balance, bnbBefore);
        assertEq(address(token).balance, 0);
        assertEq(token.allowance(alice, address(core)), 0);
    }

    function test_HolderOverBurnIsAtomicAndZeroBurnIsStandard() public {
        core.mint(token, alice, 4);
        vm.prank(alice);
        token.burn(0);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 4, 5));
        vm.prank(alice);
        token.burn(5);
        assertEq(token.balanceOf(alice), 4);
        assertEq(token.totalSupply(), 4);
    }

    function test_OnlyCoreMayBurnFromEvenWithThirdPartyApproval() public {
        core.mint(token, alice, 9);
        vm.prank(alice);
        token.approve(spender, 9);
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedBurner.selector, spender));
        vm.prank(spender);
        token.burnFrom(alice, 9);
        assertEq(token.allowance(alice, spender), 9);
        assertEq(token.balanceOf(alice), 9);
        assertEq(token.totalSupply(), 9);
    }

    function test_CoreBurnConsumesFiniteAllowanceAndSupply() public {
        core.mint(token, alice, 100);
        vm.prank(alice);
        token.approve(address(core), 60);
        core.burnFrom(token, alice, 40);
        assertEq(token.allowance(alice, address(core)), 20);
        assertEq(token.balanceOf(alice), 60);
        assertEq(token.totalSupply(), 60);
        assertEq(token.balanceOf(address(core)), 0);
    }

    function test_CoreBurnKeepsInfiniteAllowance() public {
        core.mint(token, alice, 100);
        vm.prank(alice);
        token.approve(address(core), type(uint256).max);
        core.burnFrom(token, alice, 100);
        assertEq(token.allowance(alice, address(core)), type(uint256).max);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_CoreCannotBurnWithoutApproval() public {
        core.mint(token, alice, 100);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(core), 0, 1));
        core.burnFrom(token, alice, 1);
        assertEq(token.balanceOf(alice), 100);
        assertEq(token.totalSupply(), 100);
    }

    function test_CoreInsufficientBalanceRestoresBurnAllowance() public {
        core.mint(token, alice, 4);
        vm.prank(alice);
        token.approve(address(core), 20);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 4, 5));
        core.burnFrom(token, alice, 5);
        assertEq(token.allowance(alice, address(core)), 20);
        assertEq(token.balanceOf(alice), 4);
        assertEq(token.totalSupply(), 4);
    }

    function test_LocalPostBurnFailureRollsBackTokenAndAllowance() public {
        core.mint(token, alice, 50);
        vm.prank(alice);
        token.approve(address(core), 40);
        vm.expectRevert("local post-burn failure");
        core.burnThenFail(token, alice, 30);
        assertEq(token.allowance(alice, address(core)), 40);
        assertEq(token.balanceOf(alice), 50);
        assertEq(token.totalSupply(), 50);
    }

    function test_MaxUint256SupplyCanBeFullyBurnedAndMintedAgain() public {
        core.mint(token, alice, type(uint256).max);
        vm.prank(alice);
        token.burn(type(uint256).max);
        assertEq(token.totalSupply(), 0);
        core.mint(token, alice, 1);
        assertEq(token.totalSupply(), 1);
        assertEq(token.balanceOf(alice), 1);
    }

    function testFuzz_OnlyBoundCoreMayBurnFrom(address caller, uint256 amount) public {
        vm.assume(caller != address(core));
        core.mint(token, alice, amount);
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedBurner.selector, caller));
        vm.prank(caller);
        token.burnFrom(alice, amount);
        assertEq(token.totalSupply(), amount);
        assertEq(token.balanceOf(alice), amount);
    }

    function testFuzz_HolderBurnAccounting(uint256 minted, uint256 burned) public {
        burned = bound(burned, 0, minted);
        core.mint(token, alice, minted);
        vm.prank(alice);
        token.burn(burned);
        assertEq(token.balanceOf(alice), minted - burned);
        assertEq(token.totalSupply(), minted - burned);
    }

    function test_ZeroCoreIsRejected() public {
        vm.expectRevert(WorldTokenBSCV2.InvalidCore.selector);
        new WorldTokenBSCV2(address(0));
    }

    function test_CoreMayBeBoundBeforeItsCodeIsDeployed() public {
        address futureCore = makeAddr("futureCore");
        assertEq(futureCore.code.length, 0);
        WorldTokenBSCV2 futureToken = new WorldTokenBSCV2(futureCore);
        assertEq(futureToken.core(), futureCore);
        vm.prank(futureCore);
        futureToken.mint(alice, 1);
        assertEq(futureToken.balanceOf(alice), 1);
    }

    function test_OrdinaryAddressCannotMint() public {
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedMinter.selector, alice));
        vm.prank(alice);
        token.mint(alice, 1 ether);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_DeployerCannotMint() public {
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedMinter.selector, address(this)));
        token.mint(address(this), 1 ether);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(address(this)), 0);
    }

    function test_NonCoreContractCannotMint() public {
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedMinter.selector, address(unauthorized)));
        unauthorized.mint(token, alice, 1 ether);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_CoreMintUpdatesBalanceSupplyAndTransferEvent() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(address(0), alice, 123 ether);
        core.mint(token, alice, 123 ether);
        assertEq(token.balanceOf(alice), 123 ether);
        assertEq(token.totalSupply(), 123 ether);
        assertEq(token.balanceOf(address(core)), 0);

        core.mint(token, alice, 7);
        core.mint(token, bob, 11);
        assertEq(token.balanceOf(alice), 123 ether + 7);
        assertEq(token.balanceOf(bob), 11);
        assertEq(token.totalSupply(), 123 ether + 18);
    }

    function test_ZeroAmountMintKeepsStandardERC20Behavior() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(address(0), alice, 0);
        core.mint(token, alice, 0);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_MintToZeroAddressRevertsWithoutChanges() public {
        core.mint(token, alice, 5);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        core.mint(token, address(0), 3);
        assertEq(token.totalSupply(), 5);
        assertEq(token.balanceOf(alice), 5);
        assertEq(token.balanceOf(address(0)), 0);
    }

    function test_TransferMovesExactAmountAndEmitsEvent() public {
        core.mint(token, alice, 100 ether);
        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(alice, bob, 35 ether);
        vm.prank(alice);
        assertTrue(token.transfer(bob, 35 ether));
        assertEq(token.balanceOf(alice), 65 ether);
        assertEq(token.balanceOf(bob), 35 ether);
        assertEq(token.totalSupply(), 100 ether);
        assertEq(token.balanceOf(address(core)), 0);
        assertEq(token.balanceOf(address(token)), 0);
    }

    function test_ZeroTransferAndSelfTransferAreStandard() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(alice, bob, 0);
        vm.prank(alice);
        assertTrue(token.transfer(bob, 0));

        core.mint(token, alice, 9);
        vm.prank(alice);
        assertTrue(token.transfer(alice, 9));
        assertEq(token.balanceOf(alice), 9);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.totalSupply(), 9);
    }

    function test_ApproveAndTransferFromUpdateAllowanceAndBalances() public {
        core.mint(token, alice, 100);
        vm.expectEmit(true, true, false, true, address(token));
        emit Approval(alice, spender, 60);
        vm.prank(alice);
        assertTrue(token.approve(spender, 60));
        assertEq(token.allowance(alice, spender), 60);

        vm.expectEmit(true, true, false, true, address(token));
        emit Transfer(alice, bob, 40);
        vm.prank(spender);
        assertTrue(token.transferFrom(alice, bob, 40));
        assertEq(token.balanceOf(alice), 60);
        assertEq(token.balanceOf(bob), 40);
        assertEq(token.allowance(alice, spender), 20);
        assertEq(token.totalSupply(), 100);

        vm.prank(alice);
        assertTrue(token.approve(spender, 0));
        assertEq(token.allowance(alice, spender), 0);
    }

    function test_ApproveReplacesExistingAllowance() public {
        vm.startPrank(alice);
        token.approve(spender, 10);
        token.approve(spender, 4);
        vm.stopPrank();
        assertEq(token.allowance(alice, spender), 4);
        assertEq(token.totalSupply(), 0);
    }

    function test_MaxAllowanceIsNotDecremented() public {
        core.mint(token, alice, 12);
        vm.prank(alice);
        token.approve(spender, type(uint256).max);
        vm.prank(spender);
        assertTrue(token.transferFrom(alice, bob, 12));
        assertEq(token.allowance(alice, spender), type(uint256).max);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), 12);
        assertEq(token.totalSupply(), 12);
    }

    function test_InsufficientBalanceTransferRevertsWithoutChanges() public {
        core.mint(token, alice, 10);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 10, 11));
        vm.prank(alice);
        token.transfer(bob, 11);
        assertEq(token.balanceOf(alice), 10);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.totalSupply(), 10);
    }

    function test_InsufficientAllowanceTransferFromRevertsWithoutChanges() public {
        core.mint(token, alice, 10);
        vm.prank(alice);
        token.approve(spender, 3);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, spender, 3, 4));
        vm.prank(spender);
        token.transferFrom(alice, bob, 4);
        assertEq(token.allowance(alice, spender), 3);
        assertEq(token.balanceOf(alice), 10);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.totalSupply(), 10);
    }

    function test_InsufficientBalanceTransferFromRestoresSpentAllowance() public {
        core.mint(token, alice, 10);
        vm.prank(alice);
        token.approve(spender, 20);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 10, 11));
        vm.prank(spender);
        token.transferFrom(alice, bob, 11);
        assertEq(token.allowance(alice, spender), 20);
        assertEq(token.balanceOf(alice), 10);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.totalSupply(), 10);
    }

    function test_TransferToZeroAddressRevertsWithoutBurning() public {
        core.mint(token, alice, 10);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        vm.prank(alice);
        token.transfer(address(0), 4);
        assertEq(token.balanceOf(alice), 10);
        assertEq(token.balanceOf(address(0)), 0);
        assertEq(token.totalSupply(), 10);
    }

    function test_ZeroAmountTransferToZeroStillReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        vm.prank(alice);
        token.transfer(address(0), 0);
        assertEq(token.totalSupply(), 0);
    }

    function test_TransferFromToZeroRestoresAllowanceWithoutBurning() public {
        core.mint(token, alice, 10);
        vm.prank(alice);
        token.approve(spender, 6);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        vm.prank(spender);
        token.transferFrom(alice, address(0), 4);
        assertEq(token.allowance(alice, spender), 6);
        assertEq(token.balanceOf(alice), 10);
        assertEq(token.balanceOf(address(0)), 0);
        assertEq(token.totalSupply(), 10);
    }

    function test_ApproveZeroSpenderReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidSpender.selector, address(0)));
        vm.prank(alice);
        token.approve(address(0), 1);
        assertEq(token.allowance(alice, address(0)), 0);
    }

    function test_MintAndTransferDoNotCallRecipient() public {
        RejectAllCallsV2 receiver = new RejectAllCallsV2();
        core.mint(token, address(receiver), 7);
        core.mint(token, alice, 10);
        vm.prank(alice);
        assertTrue(token.transfer(address(receiver), 10));
        assertEq(token.balanceOf(address(receiver)), 17);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.totalSupply(), 17);
    }

    function test_Uint256MaximumCanBeMintedAndTransferred() public {
        uint256 maximum = type(uint256).max;
        core.mint(token, alice, maximum);
        assertEq(token.totalSupply(), maximum);
        assertEq(token.balanceOf(alice), maximum);
        vm.prank(alice);
        assertTrue(token.transfer(bob, maximum));
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), maximum);
        assertEq(token.totalSupply(), maximum);
    }

    function test_Uint256OverflowMintRevertsAtomically() public {
        uint256 maximum = type(uint256).max;
        core.mint(token, alice, maximum - 1);
        core.mint(token, bob, 1);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        core.mint(token, bob, 1);
        assertEq(token.totalSupply(), maximum);
        assertEq(token.balanceOf(alice), maximum - 1);
        assertEq(token.balanceOf(bob), 1);
        assertEq(token.core(), address(core));
    }

    function test_ABIAndCompilerMethodTableExposeExactlyThirteenFunctions() public view {
        string memory artifact = vm.readFile(string.concat(vm.projectRoot(), "/out/WorldTokenBSCV2.sol/WorldTokenBSCV2.json"));
        uint256 functions;
        uint256 constructors;
        for (uint256 i; vm.keyExistsJson(artifact, string.concat(".abi[", vm.toString(i), "]")); ++i) {
            string memory entryPath = string.concat(".abi[", vm.toString(i), "].type");
            bytes32 entryType = keccak256(bytes(vm.parseJsonString(artifact, entryPath)));
            if (entryType == keccak256("function")) {
                ++functions;
            } else if (entryType == keccak256("constructor")) {
                ++constructors;
            } else {
                assertTrue(entryType == keccak256("event") || entryType == keccak256("error"));
            }
        }
        assertEq(functions, 13, "unexpected public/external ABI function");
        assertEq(constructors, 1);

        string[] memory methods = vm.parseJsonKeys(artifact, ".methodIdentifiers");
        string[13] memory expected = [
            string("allowance(address,address)"),
            "approve(address,uint256)",
            "balanceOf(address)",
            "burn(uint256)",
            "burnFrom(address,uint256)",
            "core()",
            "decimals()",
            "mint(address,uint256)",
            "name()",
            "symbol()",
            "totalSupply()",
            "transfer(address,uint256)",
            "transferFrom(address,address,uint256)"
        ];
        assertEq(methods.length, expected.length, "unexpected compiled dispatch entry");
        for (uint256 i; i < expected.length; ++i) {
            uint256 matches;
            for (uint256 k; k < methods.length; ++k) {
                if (keccak256(bytes(expected[i])) == keccak256(bytes(methods[k]))) ++matches;
            }
            assertEq(matches, 1, expected[i]);
        }
    }

    function test_ForbiddenSelectorsRevertForDeployerAndCoreWithoutChangingState() public {
        core.mint(token, alice, 10);
        bytes[] memory calls = new bytes[](21);
        calls[0] = abi.encodeWithSignature("setCore(address)", alice);
        calls[1] = abi.encodeWithSignature("changeMinter(address)", alice);
        calls[2] = abi.encodeWithSignature("transferOwnership(address)", alice);
        calls[3] = abi.encodeWithSignature("grantRole(bytes32,address)", bytes32(0), alice);
        calls[4] = abi.encodeWithSignature("mintForSaleDeficit(address,uint256)", alice, 1);
        calls[5] = abi.encodeWithSignature("mint(uint256)", 1);
        calls[6] = abi.encodeWithSignature("forceBurn(address,uint256)", alice, 1);
        calls[7] = abi.encodeWithSignature("burnWithoutApproval(address,uint256)", alice, 1);
        calls[8] = abi.encodeWithSignature("owner()");
        calls[9] = abi.encodeWithSignature("admin()");
        calls[10] = abi.encodeWithSignature("pause()");
        calls[11] = abi.encodeWithSignature("unpause()");
        calls[12] = abi.encodeWithSignature("blacklist(address)", alice);
        calls[13] = abi.encodeWithSignature("whitelist(address)", alice);
        calls[14] = abi.encodeWithSignature("setTax(uint256)", 1);
        calls[15] = abi.encodeWithSignature("setTaxRate(uint256)", 1);
        calls[16] = abi.encodeWithSignature("rebase(uint256)", 1);
        calls[17] = abi.encodeWithSignature("upgradeTo(address)", alice);
        calls[18] = abi.encodeWithSignature("initialize(address)", alice);
        calls[19] = abi.encodeWithSignature("setMinter(address)", alice);
        calls[20] = abi.encodeWithSignature("setAdmin(address)", alice);

        for (uint256 i; i < calls.length; ++i) {
            (bool deployerSuccess,) = address(token).call(calls[i]);
            assertFalse(deployerSuccess, "deployer reached a forbidden selector");
            vm.prank(address(core));
            (bool coreSuccess,) = address(token).call(calls[i]);
            assertFalse(coreSuccess, "Core reached a forbidden selector");
        }
        assertEq(token.core(), address(core));
        assertEq(token.totalSupply(), 10);
        assertEq(token.balanceOf(alice), 10);
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.balanceOf(address(core)), 0);

        // Failed setter attempts do not transfer mint permission.
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedMinter.selector, alice));
        vm.prank(alice);
        token.mint(alice, 1);
        core.mint(token, bob, 1);
        assertEq(token.balanceOf(bob), 1);
        assertEq(token.totalSupply(), 11);
    }

    function test_EmptyAndUnknownCalldataAndBNBAreRejected() public {
        (bool emptySuccess,) = address(token).call("");
        assertFalse(emptySuccess);
        (bool unknownSuccess,) = address(token).call(hex"ffffffff");
        assertFalse(unknownSuccess);

        vm.deal(address(this), 2);
        (bool paymentSuccess,) = address(token).call{value: 1}("");
        assertFalse(paymentSuccess);
        vm.deal(address(core), 1);
        vm.prank(address(core));
        (bool paidMintSuccess,) = address(token).call{value: 1}(abi.encodeCall(token.mint, (alice, 1)));
        assertFalse(paidMintSuccess);
        assertEq(address(token).balance, 0);
        assertEq(token.totalSupply(), 0);
    }

    function testFuzz_OnlyBoundCoreMayMint(address caller, address recipient, uint256 amount) public {
        vm.assume(caller != address(core));
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedMinter.selector, caller));
        vm.prank(caller);
        token.mint(recipient, amount);
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(recipient), 0);
        assertEq(token.core(), address(core));
    }

    function testFuzz_CoreMintAddsExactly(uint256 first, uint256 second) public {
        second = bound(second, 0, type(uint256).max - first);
        core.mint(token, alice, first);
        core.mint(token, bob, second);
        assertEq(token.balanceOf(alice), first);
        assertEq(token.balanceOf(bob), second);
        assertEq(token.totalSupply(), first + second);
    }

    function testFuzz_TransferConservesSupply(uint256 minted, uint256 moved) public {
        moved = bound(moved, 0, minted);
        core.mint(token, alice, minted);
        vm.prank(alice);
        assertTrue(token.transfer(bob, moved));
        assertEq(token.balanceOf(alice), minted - moved);
        assertEq(token.balanceOf(bob), moved);
        assertEq(token.totalSupply(), minted);
    }

    function testFuzz_AllowanceAndTransferAccounting(uint256 minted, uint256 allowed, uint256 moved) public {
        allowed = bound(allowed, 0, minted);
        moved = bound(moved, 0, allowed);
        core.mint(token, alice, minted);
        vm.prank(alice);
        token.approve(spender, allowed);
        vm.prank(spender);
        assertTrue(token.transferFrom(alice, bob, moved));
        assertEq(token.balanceOf(alice), minted - moved);
        assertEq(token.balanceOf(bob), moved);
        assertEq(token.totalSupply(), minted);
        assertEq(token.allowance(alice, spender), allowed == type(uint256).max ? allowed : allowed - moved);
    }
}
