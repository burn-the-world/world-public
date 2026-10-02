import { describe,it,expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { zeroAddress, type Address } from 'viem'
import { LandDetail, BuyForm, WithdrawForm, ProfileForm, canTransact } from '../src/Transactions'
import { B,W,TOKEN_UNIT,RESISTANCE_Q,RESISTANCE_LIMIT,MAX_WAR_ATOMS,type WorldSnapshot } from '../src/domain'
import type { AppProps } from '../src/uiTypes'

const alice='0x1111111111111111111111111111111111111111' as Address
const core='0x2222222222222222222222222222222222222222' as Address
const token='0x3333333333333333333333333333333333333333' as Address
const profile='0x4444444444444444444444444444444444444444' as Address
function props(raw=100n*TOKEN_UNIT*RESISTANCE_Q):AppProps {
  const snapshot:WorldSnapshot={blockNumber:42n,timestamp:1700000000n,U:0n,J:100n*B,accountedBNB:100n,coreNativeBalance:100n,totalSupply:1000n*TOKEN_UNIT,coreWorldBalance:0n,
    parameters:{N:50,W,B,T:5184000n,worldPrice:10n**12n,tokenUnit:TOKEN_UNIT,resistanceHalfLife:3888000n,maxWarAtoms:MAX_WAR_ATOMS,resistanceLimit:RESISTANCE_LIMIT},
    lands:[{id:1,weight:6n,controller:alice,resistanceRaw:raw,lastResistanceUpdate:1699999999n,currentResistanceRaw:raw,minimumAttackAtoms:raw/RESISTANCE_Q+1n,epoch:1n,j:0n}],
    addresses:{core,token,profile},wallet:{address:alice,balance:1000n*TOKEN_UNIT,nativeBalance:10n*TOKEN_UNIT,allowance:0n,claimable:2n*W*B+1n}}
  return {snapshot,profiles:{1:{status:'available',valid:false,controller:alice,epoch:1n,name:'',logoURI:'',website:''}},profileLimits:{name:64,logoURI:256,website:256},
    account:alice,walletChainId:31359,config:{chainId:31359,rpcUrl:'http://127.0.0.1:18559',nativeSymbol:'BNB',deploymentAddress:core,deploymentBlock:1n,recentBlockWindow:5000n},loading:false,busy:false,
    connect:async()=>{},disconnect:()=>{},switchChain:async()=>{},refresh:async()=>{},quoteBuy:async()=>1n,onAction:async()=>true}
}
const detail=(p:AppProps)=>renderToStaticMarkup(<LandDetail p={p} id={1} onClose={()=>{}} onWithdraw={()=>{}}/>)
describe('V2 transaction components (SSR fixtures; browser suite separate)',()=>{
  it('renders one name input and never displays stored legacy images or websites',()=>{
    const p=props();p.profiles[1]={...p.profiles[1],valid:true,name:'Rabbit Hole',logoURI:'https://legacy.example/hidden.png',website:'https://legacy.example/hidden-site'}
    const html=renderToStaticMarkup(<ProfileForm p={p} land={p.snapshot!.lands[0]}/>)+detail(p)
    expect(html.match(/<input id="profile-name"/g)).toHaveLength(1)
    expect(html).toContain('Rabbit Hole');expect(html).not.toContain('legacy.example');expect(html).not.toMatch(/<img|profile-logo|profile-website|profile-logo-preview/)
  })
  it('shows exact equality as wall zero without takeover and explains full Burn',()=>{
    const html=detail(props());expect(html).toContain('相等归零 · 不换主');expect(html).toContain('本次即时 Burn');expect(html).not.toContain('Reserve');expect(html).not.toContain('Pressure');expect(html).not.toContain('锁入');
  })
  it('retains positive subatom Resistance and fractional excess',()=>{
    const html=detail(props(1n));expect(html).toContain('防线精度与快照');expect(html).toContain('有效 Q64 raw');expect(html).toContain('0.000000000000000000');expect(html).toContain('自战跨线');
  })
  it('labels a minimum outside the exclusive war domain without substituting a smaller attack',()=>{
    const html=detail(props(RESISTANCE_LIMIT-1n));expect(html).toContain('当前快照无法单笔跨线');expect(html).not.toContain('class="text-button minimum-button"');
  })
  it('keeps Profile editing available to a current owner with no valid submission',()=>{
    expect(detail(props())).toContain('>土地名称</button>');
  })
  it('distinguishes neutral treasure and never invents a controller on a missing snapshot',()=>{
    const p=props(0n);p.snapshot!.lands[0].controller=zeroAddress;expect(detail(p)).toContain('荒地宝藏');p.snapshot=undefined;expect(detail(p)).toContain('正在等待世界状态');expect(detail(p)).not.toContain('UNCLAIMED');
  })
  it('shows full mint and recipient, not recycled inventory in Buy',()=>{
    const html=renderToStaticMarkup(<BuyForm p={props()}/>);expect(html).toContain('本次全量 mint');expect(html).toContain('收币地址');expect(html).not.toContain('Reserve');expect(html).not.toContain('缺口');
  })
  it('keeps lost-owner settled claims withdrawable and retains subwei remainder',()=>{
    const p=props();p.snapshot!.lands=[];const html=renderToStaticMarkup(<WithdrawForm p={p} onLand={()=>{}}/>);expect(html).toContain('0.000000000000000002');expect(html).toContain('提取已结算 BNB');expect(html).not.toContain('settlement-list');expect(html).toContain('不足 1 wei');
  })
  it('blocks write controls for stale, wrong wallet, wrong network, missing snapshot and in-flight states',()=>{
    const p=props();expect(canTransact(p)).toBe(true);
    for(const patch of [{stale:true},{busy:true},{snapshot:undefined},{account:token},{walletChainId:56}])expect(canTransact({...p,...patch})).toBe(false);
  })
})
