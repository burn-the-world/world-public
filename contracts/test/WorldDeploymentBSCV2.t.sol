// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {WorldTokenBSCV2} from "../src/WorldTokenBSCV2.sol";
import {WorldCoreBSCV2} from "../src/WorldCoreBSCV2.sol";
import {WorldLandProfileBSCV2} from "../src/WorldLandProfileBSCV2.sol";
import {WorldDeploymentBSCV2} from "../src/WorldDeploymentBSCV2.sol";

contract WorldDeploymentBSCV2Test is Test {
    event WorldDeployed(address indexed token, address indexed core, address indexed profile);

    WorldDeploymentBSCV2 internal deployment;
    WorldTokenBSCV2 internal token;
    WorldCoreBSCV2 internal core;
    WorldLandProfileBSCV2 internal profile;

    address internal buyer = makeAddr("deployment-buyer");
    address internal recipient = makeAddr("deployment-recipient");

    function setUp() public {
        deployment = new WorldDeploymentBSCV2();
        token = deployment.token();
        core = deployment.core();
        profile = deployment.profile();
    }

    function test_CreatePredictionAndPermanentBindingsMatch() public view {
        assertEq(address(token), vm.computeCreateAddress(address(deployment), 1));
        assertEq(address(core), vm.computeCreateAddress(address(deployment), 2));
        assertEq(address(profile), vm.computeCreateAddress(address(deployment), 3));
        assertEq(token.core(), address(core));
        assertEq(address(core.token()), address(token));
        assertEq(address(profile.core()), address(core));
        assertGt(address(token).code.length, 0);
        assertGt(address(core).code.length, 0);
        assertGt(address(profile).code.length, 0);
        assertEq(vm.getNonce(address(deployment)), 4);
        assertEq(core.N(), 50);
        assertEq(core.W(), 65);
        assertEq(core.T(), 60 days);
        assertEq(core.RESISTANCE_HALF_LIFE(), 45 days);
        assertEq(core.TOKEN_UNIT(), 1e18);
        assertEq(core.WORLD_PRICE(), 1e12);
        assertEq(token.decimals(), 18);
    }

    function test_NoPremintOrDeploymentPrivileges() public view {
        assertEq(token.totalSupply(), 0);
        assertEq(token.balanceOf(address(deployment)), 0);
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.balanceOf(address(core)), 0);
        assertEq(token.balanceOf(address(profile)), 0);
        assertEq(token.allowance(address(core), address(deployment)), 0);
        assertEq(token.allowance(address(core), address(this)), 0);
        assertEq(token.allowance(address(core), address(profile)), 0);
        assertEq(address(deployment).balance, 0);
        assertEq(address(core).balance, 0);
        assertEq(address(profile).balance, 0);


        assertEq(core.U0(), 0);
        assertEq(core.J0(), 0);
        assertEq(core.accountedBNB(), 0);
        assertEq(core.claimable(address(deployment)), 0);
        assertEq(core.claimable(address(this)), 0);
        assertEq(core.claimable(address(profile)), 0);
    }

    function test_AllFiftyLandsAndProfilesBeginUnset() public view {
        for (uint256 id = 1; id <= 50; ++id) {
            (address controller, uint256 resistanceRaw, uint64 lastResistanceUpdate, uint256 epoch, uint256 j) = core.lands(id);
            assertEq(controller, address(0));
            assertEq(resistanceRaw, 0);
            assertEq(lastResistanceUpdate, 0);
            assertEq(epoch, 0);
            assertEq(j, 0);

            (
                bool valid,
                address profileController,
                uint256 profileEpoch,
                string memory name,
                string memory logoURI,
                string memory website
            ) = profile.getCurrentProfile(id);
            assertFalse(valid);
            assertEq(profileController, address(0));
            assertEq(profileEpoch, 0);
            assertEq(bytes(name).length, 0);
            assertEq(bytes(logoURI).length, 0);
            assertEq(bytes(website).length, 0);
        }
    }

    function test_DeploymentEmitsTheVerifiedThreeContracts() public {
        address expectedDeployment = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        address expectedToken = vm.computeCreateAddress(expectedDeployment, 1);
        address expectedCore = vm.computeCreateAddress(expectedDeployment, 2);
        address expectedProfile = vm.computeCreateAddress(expectedDeployment, 3);
        vm.expectEmit(true, true, true, true, expectedDeployment);
        emit WorldDeployed(expectedToken, expectedCore, expectedProfile);
        WorldDeploymentBSCV2 second = new WorldDeploymentBSCV2();
        assertEq(address(second.token()), expectedToken);
        assertEq(address(second.core()), expectedCore);
        assertEq(address(second.profile()), expectedProfile);
    }

    function test_FailedCoreConstructorRollsBackFactoryAndBothChildren() public {
        address expectedDeployment = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        address expectedToken = vm.computeCreateAddress(expectedDeployment, 1);
        address expectedCore = vm.computeCreateAddress(expectedDeployment, 2);
        address expectedProfile = vm.computeCreateAddress(expectedDeployment, 3);
        vm.warp(uint256(type(uint64).max) + 1);
        vm.expectRevert(WorldCoreBSCV2.InvalidTime.selector);
        new WorldDeploymentBSCV2();
        assertEq(expectedDeployment.code.length, 0);
        assertEq(expectedToken.code.length, 0);
        assertEq(expectedCore.code.length, 0);
        assertEq(expectedProfile.code.length, 0);
    }

    function test_LocalWrongWorldParameterResponsesRollBackBeforeProfile() public {
        bytes[6] memory calls = [
            abi.encodeWithSignature("N()"), abi.encodeWithSignature("W()"), abi.encodeWithSignature("T()"),
            abi.encodeWithSignature("RESISTANCE_HALF_LIFE()"), abi.encodeWithSignature("WORLD_PRICE()"),
            abi.encodeWithSignature("TOKEN_UNIT()")
        ];
        uint256[6] memory invalidValues = [uint256(300), uint256(387), uint256(30 days), uint256(60 days), uint256(1e13), uint256(1e6)];
        for (uint256 i; i < calls.length; ++i) {
            address expectedDeployment = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
            address expectedToken = vm.computeCreateAddress(expectedDeployment, 1);
            address expectedCore = vm.computeCreateAddress(expectedDeployment, 2);
            address expectedProfile = vm.computeCreateAddress(expectedDeployment, 3);
            // A local response fixture exercises the factory's explicit parameter checks.
            vm.mockCall(expectedCore, calls[i], abi.encode(invalidValues[i]));
            // Keep the target empty so this fixture cannot prevent the actual CREATE.
            vm.etch(expectedCore, hex"");
            vm.expectRevert(WorldDeploymentBSCV2.InvalidBinding.selector);
            new WorldDeploymentBSCV2();
            vm.clearMockedCalls();
            assertEq(expectedDeployment.code.length, 0);
            assertEq(expectedToken.code.length, 0);
            assertEq(expectedCore.code.length, 0);
            assertEq(expectedProfile.code.length, 0);
        }
    }

    function test_LocalWrongTokenParameterResponsesRollBackChildren() public {
        bytes[3] memory calls = [
            abi.encodeWithSignature("decimals()"), abi.encodeWithSignature("totalSupply()"), abi.encodeWithSignature("core()")
        ];
        bytes[3] memory invalidValues = [abi.encode(uint8(6)), abi.encode(uint256(1)), abi.encode(buyer)];
        for (uint256 i; i < calls.length; ++i) {
            address expectedDeployment = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
            address expectedToken = vm.computeCreateAddress(expectedDeployment, 1);
            address expectedCore = vm.computeCreateAddress(expectedDeployment, 2);
            address expectedProfile = vm.computeCreateAddress(expectedDeployment, 3);
            vm.mockCall(expectedToken, calls[i], invalidValues[i]);
            vm.etch(expectedToken, hex"");
            // A wrong Core binding may be rejected by the real Core constructor first.
            vm.expectRevert();
            new WorldDeploymentBSCV2();
            vm.clearMockedCalls();
            assertEq(expectedDeployment.code.length, 0);
            assertEq(expectedToken.code.length, 0);
            assertEq(expectedCore.code.length, 0);
            assertEq(expectedProfile.code.length, 0);
        }
    }

    function test_FailedProfileConstructorRollsBackFactoryAndAllChildren() public {
        address expectedDeployment = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        address expectedToken = vm.computeCreateAddress(expectedDeployment, 1);
        address expectedCore = vm.computeCreateAddress(expectedDeployment, 2);
        address expectedProfile = vm.computeCreateAddress(expectedDeployment, 3);
        // The factory's first N read passes; the real Profile constructor's N read fails.
        bytes[] memory landCounts = new bytes[](2);
        landCounts[0] = abi.encode(uint256(50));
        landCounts[1] = abi.encode(uint256(49));
        vm.mockCalls(expectedCore, abi.encodeWithSignature("N()"), landCounts);
        vm.etch(expectedCore, hex"");
        vm.expectRevert(WorldLandProfileBSCV2.InvalidCore.selector);
        new WorldDeploymentBSCV2();
        vm.clearMockedCalls();
        assertEq(expectedDeployment.code.length, 0);
        assertEq(expectedToken.code.length, 0);
        assertEq(expectedCore.code.length, 0);
        assertEq(expectedProfile.code.length, 0);
        assertEq(vm.getNonce(expectedDeployment), 0);
        assertEq(vm.getNonce(expectedToken), 0);
        assertEq(vm.getNonce(expectedCore), 0);
        assertEq(vm.getNonce(expectedProfile), 0);
    }

    function test_ProfileBindingCheckFailureRollsBackAllThreeChildren() public {
        address expectedDeployment = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        address expectedToken = vm.computeCreateAddress(expectedDeployment, 1);
        address expectedCore = vm.computeCreateAddress(expectedDeployment, 2);
        address expectedProfile = vm.computeCreateAddress(expectedDeployment, 3);
        // Override only the post-construction binding read; deploy all three real contracts.
        vm.mockCall(expectedProfile, abi.encodeWithSignature("core()"), abi.encode(address(core)));
        vm.etch(expectedProfile, hex"");
        vm.expectRevert(WorldDeploymentBSCV2.InvalidBinding.selector);
        new WorldDeploymentBSCV2();
        vm.clearMockedCalls();
        assertEq(expectedDeployment.code.length, 0);
        assertEq(expectedToken.code.length, 0);
        assertEq(expectedCore.code.length, 0);
        assertEq(expectedProfile.code.length, 0);
    }

    function test_DeployerFactoryProfileAndBuyerCannotMint() public {
        address[4] memory callers = [address(this), address(deployment), address(profile), buyer];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedMinter.selector, callers[i]));
            token.mint(recipient, 1);
        }
        assertEq(token.totalSupply(), 0);
    }

    function test_RealCorePurchaseMintsOnlyPaidQuantity() public {
        uint256 quantity = 23 ether;
        uint256 cost = core.quoteBuy(quantity);
        assertEq(cost, 23 * 1e12);
        vm.deal(buyer, cost);

        vm.prank(buyer);
        core.buyWorld{value: cost}(quantity, recipient);

        assertEq(token.balanceOf(recipient), quantity);
        assertEq(token.totalSupply(), quantity);
        assertEq(address(core).balance, cost);
        assertEq(core.accountedBNB(), cost);
        assertEq(token.balanceOf(address(deployment)), 0);
        assertEq(token.balanceOf(address(this)), 0);
        assertEq(token.core(), address(core));
        assertEq(address(core.token()), address(token));
    }

    function test_TwoDeploymentsAreIndependentAndCannotCrossMint() public {
        WorldDeploymentBSCV2 second = new WorldDeploymentBSCV2();
        WorldTokenBSCV2 secondToken = second.token();
        WorldCoreBSCV2 secondCore = second.core();
        WorldLandProfileBSCV2 secondProfile = second.profile();

        assertNotEq(address(token), address(secondToken));
        assertNotEq(address(core), address(secondCore));
        assertNotEq(address(profile), address(secondProfile));
        assertEq(secondToken.core(), address(secondCore));
        assertEq(address(secondCore.token()), address(secondToken));
        assertEq(address(secondProfile.core()), address(secondCore));
        assertEq(address(profile.core()), address(core));
        assertEq(address(secondProfile), vm.computeCreateAddress(address(second), 3));
        assertEq(vm.getNonce(address(second)), 4);

        vm.prank(address(core));
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedMinter.selector, address(core)));
        secondToken.mint(recipient, 1);
        vm.prank(address(secondCore));
        vm.expectRevert(abi.encodeWithSelector(WorldTokenBSCV2.UnauthorizedMinter.selector, address(secondCore)));
        token.mint(recipient, 1);

        uint256 quantity = 1 ether;
        uint256 cost = secondCore.quoteBuy(quantity);
        vm.deal(buyer, cost);
        vm.prank(buyer);
        secondCore.buyWorld{value: cost}(quantity, recipient);
        assertEq(secondToken.totalSupply(), quantity);
        assertEq(secondToken.balanceOf(recipient), quantity);
        assertEq(token.totalSupply(), 0);
        assertEq(address(core).balance, 0);
    }

    function test_NoDeploymentSetterAdminMintUpgradeOrRepeatPath() public {
        bytes[] memory calls = new bytes[](15);
        calls[0] = abi.encodeWithSignature("setCore(address)", buyer);
        calls[1] = abi.encodeWithSignature("setToken(address)", buyer);
        calls[2] = abi.encodeWithSignature("changeMinter(address)", buyer);
        calls[3] = abi.encodeWithSignature("transferOwnership(address)", buyer);
        calls[4] = abi.encodeWithSignature("grantRole(bytes32,address)", bytes32(0), buyer);
        calls[5] = abi.encodeWithSignature("owner()");
        calls[6] = abi.encodeWithSignature("admin()");
        calls[7] = abi.encodeWithSignature("mint(address,uint256)", buyer, 1);
        calls[8] = abi.encodeWithSignature("upgradeTo(address)", buyer);
        calls[9] = abi.encodeWithSignature("initialize(address)", buyer);
        calls[10] = abi.encodeWithSignature("deploy()");
        calls[11] = abi.encodeWithSignature("withdraw(address,uint256)", buyer, 1);
        calls[12] = abi.encodeWithSignature("setProfile(address)", buyer);
        calls[13] = abi.encodeWithSignature("changeProfile(address)", buyer);
        calls[14] = abi.encodeWithSignature("againDeploy()");

        for (uint256 i; i < calls.length; ++i) {
            (bool success,) = address(deployment).call(calls[i]);
            assertFalse(success);
        }
        assertEq(address(deployment.token()), address(token));
        assertEq(address(deployment.core()), address(core));
        assertEq(address(deployment.profile()), address(profile));
        assertEq(token.core(), address(core));
        assertEq(address(core.token()), address(token));
        assertEq(address(profile.core()), address(core));
        assertEq(token.totalSupply(), 0);
        assertEq(vm.getNonce(address(deployment)), 4);
    }

    function test_AllThreeChildrenRejectBindingSettersFromDeployerFactoryAndProfile() public {
        address[3] memory callers = [address(this), address(deployment), address(profile)];
        bytes[3] memory calls = [
            abi.encodeWithSignature("setCore(address)", buyer),
            abi.encodeWithSignature("setToken(address)", buyer),
            abi.encodeWithSignature("changeMinter(address)", buyer)
        ];
        for (uint256 i; i < callers.length; ++i) {
            for (uint256 j; j < calls.length; ++j) {
                vm.prank(callers[i]);
                (bool tokenSuccess,) = address(token).call(calls[j]);
                assertFalse(tokenSuccess);
                vm.prank(callers[i]);
                (bool coreSuccess,) = address(core).call(calls[j]);
                assertFalse(coreSuccess);
                vm.prank(callers[i]);
                (bool profileSuccess,) = address(profile).call(calls[j]);
                assertFalse(profileSuccess);
            }
        }
        assertEq(token.core(), address(core));
        assertEq(address(core.token()), address(token));
        assertEq(address(profile.core()), address(core));
    }

    function test_FactoryHasOnlyThreeGettersAndThreeImmutablesWithoutStorage() public view {
        string memory artifact =
            vm.readFile(string.concat(vm.projectRoot(), "/out/WorldDeploymentBSCV2.sol/WorldDeploymentBSCV2.json"));
        string[] memory methods = vm.parseJsonKeys(artifact, ".methodIdentifiers");
        assertEq(methods.length, 3);
        bool sawCore;
        bool sawToken;
        bool sawProfile;
        for (uint256 i; i < methods.length; ++i) {
            bytes32 signature = keccak256(bytes(methods[i]));
            if (signature == keccak256("core()")) sawCore = true;
            else if (signature == keccak256("token()")) sawToken = true;
            else if (signature == keccak256("profile()")) sawProfile = true;
            else assertTrue(false, "unexpected factory method");
        }
        assertTrue(sawCore && sawToken && sawProfile);

        uint256 functions;
        uint256 constructors;
        for (uint256 i; vm.keyExistsJson(artifact, string.concat(".abi[", vm.toString(i), "]")); ++i) {
            string memory kindPath = string.concat(".abi[", vm.toString(i), "].type");
            bytes32 kind = keccak256(bytes(vm.parseJsonString(artifact, kindPath)));
            if (kind == keccak256("function")) ++functions;
            else if (kind == keccak256("constructor")) ++constructors;
            else assertTrue(kind == keccak256("error") || kind == keccak256("event"));
        }
        assertEq(functions, 3);
        assertEq(constructors, 1);
        assertEq(vm.parseJsonKeys(artifact, ".deployedBytecode.immutableReferences").length, 3);
        assertFalse(vm.keyExistsJson(artifact, ".storageLayout.storage[0]"));
    }

    function test_RuntimeAndFactoryInitCodeFitEVMSizeLimits() public view {
        assertLe(address(token).code.length, 24_576);
        assertLe(address(core).code.length, 24_576);
        assertLe(address(profile).code.length, 24_576);
        assertLe(address(deployment).code.length, 24_576);
        assertLe(type(WorldDeploymentBSCV2).creationCode.length, 49_152);
    }

    function test_FactoryRejectsEmptyUnknownAndValueCalls() public {
        (bool emptySuccess,) = address(deployment).call("");
        assertFalse(emptySuccess);
        (bool unknownSuccess,) = address(deployment).call(hex"ffffffff");
        assertFalse(unknownSuccess);
        vm.deal(address(this), 1);
        (bool valueSuccess,) = address(deployment).call{value: 1}(abi.encodeWithSignature("token()"));
        assertFalse(valueSuccess);
        assertEq(address(deployment).balance, 0);
    }
}
