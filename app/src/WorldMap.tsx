import { t, useI18n } from './i18n'
import { useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { Address } from 'viem';
import { formatResistance, formatWorld, isNeutral, shortAddress, type Land, type LandProfile } from './domain';
import { WORLD_MAP_LAYOUT, WORLD_MAP_VIEWBOX } from './worldMapLayout';
import './WorldMap.css';

export interface WorldMapProps {
  lands?: Land[];
  profiles?: Record<number, LandProfile>;
  selectedLandId?: number;
  account?: Address;
  /** IDs derived only from real Core war events inside the displayed block window. */
  /** IDs derived only from real Core war events inside the displayed block window. */
  maxWarAtoms?: bigint;
  onSelect: (id: number) => void;
}

const FACTION_COLORS = ['#69a596', '#7697bb', '#a993bf', '#b7a368', '#a77768', '#749888', '#82a6a8', '#9a9c6d', '#af7f97', '#7989b2', '#ba9b84', '#8ba67d'];

/** A presentation color, not an alliance identity or an on-chain field. */
/** A presentation color, not an alliance identity or an on-chain field. */
export function controllerColor(address: string): string {
  let hash = 2166136261;
  for (const character of address.toLowerCase()) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return FACTION_COLORS[(hash >>> 0) % FACTION_COLORS.length];
}

function liveProfile(land: Land | undefined, profile: LandProfile | undefined) {
  return land && profile?.status === 'available' && profile.valid
    && profile.controller.toLowerCase() === land.controller.toLowerCase() && profile.epoch === land.epoch ? profile : undefined;
}

const sortedLayout = [...WORLD_MAP_LAYOUT].sort((a, b) => a.y - b.y || a.x - b.x);
const topPoints = '0,-28 50,0 0,28 -50,0';
const smallName = (name: string) => Array.from(name).length > 10 ? Array.from(name).slice(0, 9).join('') + '…' : name;
const sameAddress = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

type View = { zoom: number; x: number; y: number };
type Point = { x: number; y: number };
const initialView: View = { zoom: 1, x: 0, y: 0 };
function clampView(view: View): View {
  const zoom = Math.max(1, Math.min(2.8, view.zoom));
  const limitX = (zoom - 1) * WORLD_MAP_VIEWBOX.width / 2;
  const limitY = (zoom - 1) * WORLD_MAP_VIEWBOX.height / 2;
  return { zoom, x: Math.max(-limitX, Math.min(limitX, view.x)), y: Math.max(-limitY, Math.min(limitY, view.y)) };
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export default function WorldMap({ lands, profiles, selectedLandId, account, maxWarAtoms, onSelect }: WorldMapProps) { useI18n();
  const unique = useId().replace(/:/g, '');
  const [hovered, setHovered] = useState<number>();
  const [view, setView] = useState<View>(initialView);
  const viewRef = useRef<View>(initialView);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; distance: number; view: View } | undefined>(undefined);
  const dragged = useRef(false);
  const ignoreClick = useRef(false);
  const landById = useMemo(() => new Map(lands?.map(land => [land.id, land]) ?? []), [lands]);
  const active = hovered === undefined ? undefined : landById.get(hovered);
  const activeProfile = liveProfile(active, hovered === undefined ? undefined : profiles?.[hovered]);
  const shownStatus = !active ? t('copy529') : isNeutral(active) ? t('label051') : shortAddress(active.controller);

  function updateView(next: View) {
    const clamped = clampView(next);
    viewRef.current = clamped;
    setView(clamped);
  }
  function zoomBy(amount: number) { updateView({ ...viewRef.current, zoom: viewRef.current.zoom + amount }); }
  function resetGesture() {
    const positions = Array.from(pointers.current.values());
    if (!positions.length) { gesture.current = undefined; return; }
    gesture.current = { start: positions.length > 1 ? midpoint(positions[0], positions[1]) : positions[0], distance: positions.length > 1 ? distance(positions[0], positions[1]) : 0, view: viewRef.current };
  }
  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) { dragged.current = false; ignoreClick.current = false; }
    if (pointers.current.size > 1) { dragged.current = true; ignoreClick.current = true; }
    resetGesture();
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const positions = Array.from(pointers.current.values());
    const current = positions.length > 1 ? midpoint(positions[0], positions[1]) : positions[0];
    const origin = gesture.current;
    if (positions.length === 1 && !dragged.current && distance(current, origin.start) < 6) return;
    dragged.current = true;
    ignoreClick.current = true;
    setHovered(undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(WORLD_MAP_VIEWBOX.width / bounds.width, WORLD_MAP_VIEWBOX.height / bounds.height);
    updateView({ zoom: positions.length > 1 && origin.distance > 0 ? origin.view.zoom * distance(positions[0], positions[1]) / origin.distance : origin.view.zoom,
      x: origin.view.x + (current.x - origin.start.x) * ratio, y: origin.view.y + (current.y - origin.start.y) * ratio });
  }
  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resetGesture();
  }

  return <section className="wm-world" aria-label={t('copy530')}>
    <div className="wm-map-label"><span>{t('label019')}</span><strong>50 LAND <i>/</i> {t('label020')}</strong></div>
    <div className="wm-map-state"><span className={lands ? 'wm-state-dot' : 'wm-state-dot wm-state-wait'} />{lands ? t('copy042', { v0: lands.filter(land => !isNeutral(land)).length }) : t('copy073')}</div>
    <svg className="wm-canvas" viewBox={`0 0 ${WORLD_MAP_VIEWBOX.width} ${WORLD_MAP_VIEWBOX.height}`} aria-label={t('copy531')} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={() => { if (!pointers.current.size) setHovered(undefined); }}>
      <defs>
        <radialGradient id={`${unique}-sea`}><stop offset="0" stopColor="#1c3338" /><stop offset=".68" stopColor="#101f26" /><stop offset="1" stopColor="#0d171d" /></radialGradient>
        <pattern id={`${unique}-grid`} width="108" height="62" patternUnits="userSpaceOnUse"><path d="M0 31 54 0 108 31 54 62Z" fill="none" stroke="#628e8b" strokeWidth=".6" opacity=".08" /></pattern>
        <linearGradient id={`${unique}-top`} x2="0.5" y2="1"><stop stopColor="#fff" stopOpacity=".07" /><stop offset="1" stopColor="#000" stopOpacity=".18" /></linearGradient>
        <linearGradient id={`${unique}-cliff`} x2="0" y2="1"><stop stopColor="#829890" stopOpacity=".18" /><stop offset="1" stopColor="#050b10" stopOpacity=".7" /></linearGradient>
        <filter id={`${unique}-shadow`} x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7" /></filter>
      </defs>
      <rect width="1160" height="700" fill={`url(#${unique}-sea)`} />
      <rect width="1160" height="700" fill={`url(#${unique}-grid)`} />
      <g className="wm-sea-details" aria-hidden="true"><path d="M95 168h47m-32 8h22m852 315h62m-49 8h31M713 78h29m-18 8h9M76 462h54m-42 8h26M542 641h48m-35 8h19" /><circle cx="1043" cy="104" r="25" /><path d="m1043 68 0 72m-36-36h72m-36-24-6 24 6-6 6 6Z" /><text x="1043" y="60">N</text></g>
      <g transform={`translate(${580 + view.x} ${350 + view.y}) scale(${view.zoom}) translate(-580 -350)`}>
        <g className="wm-shallows" aria-hidden="true"><path d="m410 173 170-104 166 103-1 71-104 47-176-44Z" /><path d="m723 242 107-55 171 100-55 128-171-52-73-68Z" /><path d="m622 493 203-89 126 81-95 126-154 7-101-67Z" /><path d="m263 491 108-56 229 126-171 82-165-43Z" /><path d="m163 262 107-69 110 63 10 145-62 30-166-97Z" /><path d="m394 324 192-114 192 106-57 154-192 67-136-130Z" /></g>
        {sortedLayout.map(location => {
          const { landId: id, x, y, elevation } = location;
          const land = landById.get(id);
          const profile = liveProfile(land, profiles?.[id]);
          const neutral = !!land && isNeutral(land);
          const controlled = !!land && !neutral;
          const mine = controlled && sameAddress(land.controller, account);
          const crown = id === 1;
          const premium = id >= 2 && id <= 6;
          const selected = selectedLandId === id;
          const tier = crown ? 'CROWN' : premium ? 'HIGHLAND' : 'LAND';
          const color = controlled ? controllerColor(land.controller) : land ? '#608e80' : '#485c5f';
          const label = profile?.name || (crown ? 'CROWN' : premium ? 'WEIGHT 3' : land ? neutral ? t('label051') : '' : '—');
          const title = `LAND #${id}${profile?.name ? ` · ${profile.name}` : ''} · Weight ${land?.weight.toString() ?? (crown ? '6' : premium ? '3' : '1')} · ${!land ? t('copy529') : neutral ? t('copy532') : shortAddress(land.controller)}`;
          return <g key={id} className={`wm-land ${crown ? 'wm-crown' : premium ? 'wm-premium' : 'wm-normal'} ${selected ? 'wm-selected' : ''} ${mine ? 'wm-mine' : ''} ${!land ? 'wm-unknown' : ''}`} style={{ '--wm-faction': color } as CSSProperties} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={title} aria-pressed={selected} data-land-id={id}
            onMouseEnter={() => { if (!pointers.current.size) setHovered(id); }} onMouseLeave={() => setHovered(current => current === id ? undefined : current)} onFocus={() => setHovered(id)} onBlur={() => setHovered(current => current === id ? undefined : current)}
            onClick={() => { if (!ignoreClick.current) onSelect(id); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(id); } }}>
            <title>{title}</title>
            <ellipse className="wm-ground-shadow" cx="0" cy="14" rx="50" ry="20" filter={`url(#${unique}-shadow)`} />
            <polygon className="wm-footprint" points="0,-27 52,2 0,32 -52,2" />
            <g transform={`translate(0 ${-elevation})`}>
              <polygon className="wm-cliff-left" points={`-50,0 0,28 0,${28 + elevation} -50,${elevation}`} />
              <polygon className="wm-cliff-right" points={`0,28 50,0 50,${elevation} 0,${28 + elevation}`} />
              <polygon className="wm-cliff-texture" points={`-50,0 0,28 50,0 50,${elevation} 0,${28 + elevation} -50,${elevation}`} fill={`url(#${unique}-cliff)`} />
              <path className="wm-cliff-seams" d={`M-34 10v${elevation - 2}m18-8v-${Math.max(6, elevation - 13)}M18 19v${elevation - 2}m16-10v-${Math.max(6, elevation - 14)}`} />
              <polygon className="wm-top" points={topPoints} />
              <polygon className="wm-top-light" points={topPoints} fill={`url(#${unique}-top)`} />
              <polygon className="wm-rim" points="0,-23 41,0 0,23 -41,0" />
              {(premium || crown) && <path className="wm-terrace" d={`M-50 ${elevation - 5} 0 ${elevation + 23} 50 ${elevation - 5}`} />}
              {crown && <g className="wm-citadel" aria-hidden="true"><path className="wm-citadel-shadow" d="m-23-15 18-12 27 16-17 11Z" /><path className="wm-citadel-side" d="M-17-20-4-12V-38L-17-46Z" /><path className="wm-citadel-front" d="m-4-12 18-11v-25L-4-38Z" /><path className="wm-citadel-roof" d="m-17-46 18-11 13 9-18 10Z" /><path className="wm-citadel-tower" d="m-23-18 6 4v-16l-6-4Zm37-8 7-4v-16l-7 4Z" /><path className="wm-citadel-window" d="m1-27 5-3v-8l-5 3Z" /><path className="wm-citadel-crown" d="m-10-54 2-8 5 5 5-9 5 9 5-5 2 8-13 6Z" /></g>}
              {controlled && <g className="wm-owner-flag" aria-hidden="true" transform="translate(27 -9)"><path d="M0 8v-24" /><path className="wm-flag-cloth" d="m0-16 15 4-5 4H0Z" /></g>}
              <text className="wm-land-number" x="0" y="3">{crown && <tspan className="wm-crown-star">✦ </tspan>}#{id}</text>
              {label && <text className={`wm-land-name ${!profile?.name ? 'wm-default-name' : ''}`} x="0" y="17">{smallName(label)}</text>}
              {mine && <circle className="wm-mine-dot" cx="-34" cy="-3" r="3.5" />}
              <polygon className="wm-focus-outline" points="0,-32 56,0 0,32 -56,0" />
            </g>
            <text className="wm-tier-label" x="0" y={crown ? '53' : '0'}>{crown ? `${tier} · 6` : ''}</text>
          </g>;
        })}
      </g>
    </svg>
    {hovered !== undefined && hovered !== selectedLandId && <div className="wm-hover-card" role="status" aria-live="polite"><div><strong>{activeProfile?.name || `LAND #${hovered}`}</strong><span>#{hovered} · W {active?.weight.toString() ?? (hovered === 1 ? '6' : hovered <= 6 ? '3' : '1')}</span></div><p title={active?.controller}>{shownStatus}{active && !isNeutral(active) && <i className="wm-controller-swatch" style={{ backgroundColor: controllerColor(active.controller) }} />}</p>{active && <dl><div><dt>{t('label021')}</dt><dd>{formatResistance(active.currentResistanceRaw)}</dd></div><div><dt>{t('copy534')}</dt><dd>{maxWarAtoms!==undefined&&active.minimumAttackAtoms>=maxWarAtoms?t('copy075'):formatWorld(active.minimumAttackAtoms)}</dd></div></dl>}<small>{active ? t('copy535') : t('copy536')}</small></div>}
    <div className="wm-view-controls" aria-label={t('copy537')}><button type="button" aria-label={t('copy538')} disabled={view.zoom >= 2.8} onClick={() => zoomBy(.3)}>＋</button><button type="button" aria-label={t('copy539')} disabled={view.zoom <= 1} onClick={() => zoomBy(-.3)}>−</button><button type="button" className="wm-reset" onClick={() => updateView(initialView)} aria-label={t('copy540')}>⌖</button><span>{Math.round(view.zoom * 100)}%</span></div>
    {view.zoom > 1 && <div className="wm-pan-controls" aria-label={t('copy541')}><button type="button" aria-label={t('copy542')} onClick={() => updateView({ ...viewRef.current, x: viewRef.current.x - 70 })}>←</button><button type="button" aria-label={t('copy543')} onClick={() => updateView({ ...viewRef.current, y: viewRef.current.y - 70 })}>↑</button><button type="button" aria-label={t('copy544')} onClick={() => updateView({ ...viewRef.current, y: viewRef.current.y + 70 })}>↓</button><button type="button" aria-label={t('copy545')} onClick={() => updateView({ ...viewRef.current, x: viewRef.current.x + 70 })}>→</button></div>}
    <div className="wm-map-legend"><span><i className="wm-legend-crown" />{t('label022')}</span><span><i className="wm-legend-highland" />{t('label023')}</span><span><i className="wm-legend-land" />{t('label024')}</span></div>
    <p className="wm-map-note">{t('copy547')}<span>{t('copy548')}</span></p>
  </section>;
}
