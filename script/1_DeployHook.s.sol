// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {ArtPoolHook} from "../src/ArtPoolHook.sol";
import {ArtSwapRouter} from "../src/ArtSwapRouter.sol";
import {Create2Factory} from "../src/Create2Factory.sol";

/// Env: POOL_MANAGER, USDC, EURC  (Arc: USDC/EURC, Tempo: USDC.e/EURC.e addresses)
contract DeployHook is Script {
    function run() external {
        IPoolManager pm = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address[] memory quotes = new address[](2);
        quotes[0] = vm.envAddress("USDC");
        quotes[1] = vm.envAddress("EURC");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();

        Create2Factory factory = new Create2Factory();
        bytes memory initCode = abi.encodePacked(type(ArtPoolHook).creationCode, abi.encode(pm, deployer, quotes));
        bytes32 initHash = keccak256(initCode);
        uint160 flags = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG;

        bytes32 salt;
        address predicted;
        for (uint256 i = 0; i < 2_000_000; i++) {
            salt = bytes32(i);
            predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), salt, initHash)))));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == flags) break;
        }
        require(uint160(predicted) & Hooks.ALL_HOOK_MASK == flags, "salt not found");

        address hook = factory.deploy(salt, initCode);
        require(hook == predicted, "address mismatch");

        ArtSwapRouter router = new ArtSwapRouter(pm);
        ArtPoolHook(hook).setRouter(address(router), true);
        vm.stopBroadcast();

        console.log("HOOK=", hook);
        console.log("ROUTER=", address(router));
        console.log("ADMIN=", deployer);
    }
}
