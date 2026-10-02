import type { Abi, Hex } from 'viem'
export const projectRoot: string
export const bundleRoot: string
export type CompiledContract = {
  abi: Abi
  bytecode: Hex
  deployedBytecode: Hex
  immutableReferences: Record<string, { start: number; length: number }[]>
}
export type ProtocolArtifacts = {
  WorldTokenBSCV2: CompiledContract
  WorldCoreBSCV2: CompiledContract
  WorldLandProfileBSCV2: CompiledContract
  WorldDeploymentBSCV2: CompiledContract
}
export function loadProtocolArtifacts(): ProtocolArtifacts
export function loadParticipantFixture(): { abi: Abi; bytecode: { object: Hex } }
export const compileContracts: typeof loadProtocolArtifacts
