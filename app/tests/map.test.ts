import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { zeroAddress, type Address } from 'viem';
import WorldMap, { controllerColor, type WorldMapProps } from '../src/WorldMap';
import { compactResistance } from '../src/ui';
import { RESISTANCE_LIMIT, RESISTANCE_Q, TOKEN_UNIT, weightOf, type Land, type LandProfile } from '../src/domain';
import { WORLD_MAP_LAYOUT, WORLD_MAP_VIEWBOX } from '../src/worldMapLayout';
import App from '../src/App';
import { loadConfig } from '../src/config';
import type { AppProps } from '../src/uiTypes';

describe('permanent WORLD atlas', () => {
  it('places each of the fifty LAND IDs exactly once at a distinct fixed location', () => {
    expect(WORLD_MAP_LAYOUT.map(location => location.landId).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(new Set(WORLD_MAP_LAYOUT.map(location => `${location.x}:${location.y}`)).size).toBe(50);
    // These named locations are stable identifiers, not a generated or sorted grid.
    expect(WORLD_MAP_LAYOUT.find(location => location.landId === 1)).toMatchObject({ x: 585, y: 375, elevation: 76 });
    expect(WORLD_MAP_LAYOUT.find(location => location.landId === 8)).toMatchObject({ x: 526, y: 144, elevation: 14 });
  });

  it('keeps the Crown above five equal highlands and forty-four equal ordinary plots', () => {
    const crown = WORLD_MAP_LAYOUT[0];
    const highlands = WORLD_MAP_LAYOUT.filter(location => location.landId >= 2 && location.landId <= 6);
    const ordinary = WORLD_MAP_LAYOUT.filter(location => location.landId >= 7);
    expect(highlands).toHaveLength(5);
    expect(ordinary).toHaveLength(44);
    expect(new Set(highlands.map(location => location.elevation)).size).toBe(1);
    expect(new Set(ordinary.map(location => location.elevation)).size).toBe(1);
    expect(crown.elevation).toBeGreaterThan(highlands[0].elevation);
    expect(highlands[0].elevation).toBeGreaterThan(ordinary[0].elevation);
    for (const location of WORLD_MAP_LAYOUT) {
      expect(location.x - 56).toBeGreaterThan(0);
      expect(location.x + 56).toBeLessThan(WORLD_MAP_VIEWBOX.width);
      expect(location.y - location.elevation - 66).toBeGreaterThan(0);
      expect(location.y + 53).toBeLessThan(WORLD_MAP_VIEWBOX.height);
    }
  });
});

const alice='0x1111111111111111111111111111111111111111' as Address;
const bob='0x2222222222222222222222222222222222222222' as Address;
function land(id:number,patch:Partial<Land>={}):Land {
  return {id,weight:weightOf(id),controller:zeroAddress,resistanceRaw:0n,lastResistanceUpdate:0n,currentResistanceRaw:0n,minimumAttackAtoms:1n,epoch:0n,j:0n,...patch};
}
function profile(patch:Partial<LandProfile>={}):LandProfile {
  return {status:'available',valid:true,controller:alice,epoch:2n,name:'Visible V2 name',logoURI:'',website:'',...patch};
}
const renderMap=(props:Partial<WorldMapProps>={})=>renderToStaticMarkup(createElement(WorldMap,{onSelect:()=>{},...props}));

describe('V2 atlas component rendering (SSR; browser interaction tested separately)',()=>{
  it('renders all 50 keyboard focusable LAND targets before chain data arrives without inventing zero walls or unclaimed ownership',()=>{
    const html=renderMap();
    expect([...html.matchAll(/data-land-id="(\d+)"/g)].map(match=>Number(match[1])).sort((a,b)=>a-b)).toEqual(Array.from({length:50},(_,i)=>i+1));
    expect(html.match(/role="button" tabindex="0"/g)).toHaveLength(50);
    expect(html).toContain('链上状态待读取');
    expect(html).not.toContain('UNCLAIMED');
    expect(html).not.toContain('Pressure');
    expect(html).not.toContain('Defense');
    expect(html).not.toContain('wm-stress');
  });
  it('keeps selected LAND accessible and selection does not depend on ownership',()=>{
    const html=renderMap({lands:[land(50)],selectedLandId:50});
    expect(html).toMatch(/aria-pressed="true" data-land-id="50"/);
    expect(html).toContain('LAND #50 · Weight 1 · 无人控制');
    expect(html).toContain('aria-label="放大地图"');
    expect(html).toContain('aria-label="缩小地图"');
    expect(html).toContain('aria-label="复位地图"');
  });
  it('derives stable controller colors case-insensitively and applies ownership only to a matching wallet',()=>{
    const address='0xabCd111111111111111111111111111111111111' as Address;
    expect(controllerColor(address)).toBe(controllerColor(address.toLowerCase()));
    const html=renderMap({lands:[land(1,{controller:alice,epoch:2n})],account:alice});
    expect(html).toContain('wm-mine');
    expect(html).toContain(`--wm-faction:${controllerColor(alice)}`);
    expect(renderMap({lands:[land(1,{controller:alice,epoch:2n})],account:bob})).not.toContain('wm-mine-dot');
  });
  it('shows names only for an available, valid controller and epoch match',()=>{
    const lands=[land(1,{controller:alice,epoch:2n})];
    expect(renderMap({lands,profiles:{1:profile()}})).toContain('Visible V2 name');
    for(const patch of [{valid:false},{status:'unavailable' as const},{epoch:1n},{controller:bob}]) {
      expect(renderMap({lands,profiles:{1:profile(patch)}})).not.toContain('Visible V2 name');
    }
    expect(renderMap({lands,profiles:{1:profile({name:''})}})).toContain('LAND #1 · Weight 6');
  });
  it('treats player names as text and never renders legacy Profile images',()=>{
    const html=renderMap({lands:[land(1,{controller:alice,epoch:2n})],profiles:{1:profile({name:'<script>alert(1)</script>',logoURI:'javascript:alert(1)'})}});
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('src="javascript:');
    expect(html).not.toContain('<image');
    expect(html).not.toContain('wm-has-artwork');
  });
  it('renders identical strategic surfaces regardless of stored image or website values',()=>{
    const lands=[land(1,{controller:alice,epoch:2n}),land(7,{controller:alice,epoch:2n})];
    const plain=renderMap({lands,profiles:{1:profile(),7:profile()}});
    const legacy=renderMap({lands,profiles:{1:profile({logoURI:'https://legacy.example/image.png',website:'https://legacy.example'}),7:profile({logoURI:'ipfs://old'})}});
    expect(legacy).toBe(plain);
  });

});

describe('compact Resistance presentation',()=>{
  it('separates unknown, exact zero and every positive sub-atom value',()=>{
    expect(compactResistance()).toBe('—');
    expect(compactResistance(0n)).toBe('0');
    expect(compactResistance(1n)).toBe('<1 atom');
    expect(compactResistance(RESISTANCE_Q-1n)).toBe('<1 atom');
    expect(compactResistance(RESISTANCE_Q)).not.toBe('0');
  });
  it('formats ordinary and high values with integer arithmetic while preserving small nonzero amounts',()=>{
    expect(compactResistance(50001n*TOKEN_UNIT*RESISTANCE_Q/100n)).toBe('500.01');
    expect(compactResistance(TOKEN_UNIT*RESISTANCE_Q/100000n)).toBe('<0.0001');
    expect(compactResistance(RESISTANCE_LIMIT-1n)).not.toMatch(/e\+|Infinity|NaN/);
  });
});

describe('current WORLD shell',()=>{
  it('renders the current world shell with V2 metrics and no obsolete reserve or pressure interface',()=>{
    const props:AppProps={profiles:{},config:loadConfig(),loading:false,busy:false,connect:async()=>{},disconnect:()=>{},switchChain:async()=>{},refresh:async()=>{},quoteBuy:async()=>1n,onAction:async()=>false};
    const html=renderToStaticMarkup(createElement(App,props));
    expect(html).toContain('BSC V2 · 50 LAND');
    expect(html).toContain('TREASURY · 未释放');
    expect(html).toContain('WORLD · 当前供应');
    expect(html).toContain('Resistance 45 天');
    expect(html).not.toMatch(/RESERVE|Reserve|Defense|Pressure|库存优先|锁仓|高攻压/);
  });
});
