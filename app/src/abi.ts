import type { Abi } from 'viem'
import core from './abi/WorldCoreBSCV2.json'
import token from './abi/WorldTokenBSCV2.json'
import deployment from './abi/WorldDeploymentBSCV2.json'
import profile from './abi/WorldLandProfileBSCV2.json'

// Exact V2 compiler exports from ../world-bsc-burn-v2/abi. Never use V1 event layouts.
export const coreAbi = core as Abi
export const tokenAbi = token as Abi
export const deploymentAbi = deployment as Abi
export const profileAbi = profile as Abi
