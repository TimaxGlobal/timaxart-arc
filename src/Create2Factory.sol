// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Tiny CREATE2 factory so the hook address (flag bits) can be mined on any chain, no assumptions about a shared deployer.
contract Create2Factory {
    function deploy(bytes32 salt, bytes calldata initCode) external returns (address a) {
        bytes memory code = initCode;
        assembly { a := create2(0, add(code, 0x20), mload(code), salt) }
        require(a != address(0), "create2 failed");
    }

    function predict(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
