import '@fontsource-variable/outfit';
import './style.css';
import { gsap } from 'gsap';
import { RaceSimulation } from './simulation';
import { RaceRenderer } from './renderer';
import { GameAudio } from './audio';
import { MUSIC_BPM, MUSIC_TITLE } from './music';
import { GameInput } from './input';
import { DRIFT_KEY_OPTIONS, displayDriftKey, readDriftKey, saveDriftKey } from './keybindings';
import { LanClient } from './network';
import { icon } from './icons';
import { minimapPath, minimapPoint, TRACK_LENGTH, TRACKS, TRACK_ORDER, isTrackId } from './track';
import { DIFFICULTIES, DIFFICULTY_ORDER, isDifficulty } from './difficulty';
import { readSelectedDifficulty, saveSelectedDifficulty, readBestTime, saveBestTime, readSelectedVehicle, saveSelectedVehicle } from './progress';
import { VEHICLES, VEHICLE_ORDER, isVehicle } from './vehicles';
import type { Difficulty, VehicleId, GamePhase, ItemType, GameEvent, RaceMode, RaceState } from './types';

const ITEMS: Record<ItemType, { name: string; subtitle: string; description: string; color: string }> = {
  rocket: { name: '追踪火箭', subtitle: 'LOCK ON. LET GO.', description: '追击前车，制造超车窗口。蓄满漂移能量，升级为强力火箭。', color: '#e96337' },
  mine: { name: '感应地雷', subtitle: 'LEAVE A SURPRISE.', description: '在车后布雷，封锁追兵路线。强化后布设更远、持续更久。', color: '#a083c8' },
  shield: { name: '能量护盾', subtitle: 'KEEP YOUR LEAD.', description: '抵御来袭武器，守住领先。强化后获得更长的保护时间。', color: '#54b8a9' },
  nitro: { name: '氮气喷射', subtitle: 'MORE IS MORE.', description: '瞬间释放动力，一路全速。强化后获得更持久的加速。', color: '#d6ad44' },
  oil: { name: '滑油陷阱', subtitle: 'WATCH YOUR LINE.', description: '在身后留下滑油，让追兵短暂失去抓地力。', color: '#4e8c7b' },
  emp: { name: '电磁脉冲', subtitle: 'CUT THE POWER.', description: '干扰前方对手的氮气与能量，抢回冲刺窗口。', color: '#8b8de7' },
  magnet: { name: '磁力牵引', subtitle: 'CATCH THE PACK.', description: '牵引前车获得追赶加速，落后时更适合使用。', color: '#e27eae' },
};

const progressStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};
const initialDifficulty = readSelectedDifficulty(progressStorage);
const initialVehicle = readSelectedVehicle(progressStorage);
const initialDriftKey = readDriftKey(progressStorage);
const vehicleDetails = {
  tide: { role: '全能巡航', subtitle: 'TIDE / BALANCED', skill: '护盾反馈：挡住道具后回复能量', description: '均衡动力，稳定过弯；护盾挡住攻击会回收少量能量。', stats: [72, 75, 74] },
  reef: { role: '灵巧过弯', subtitle: 'REEF / AGILE', skill: '灵巧推进：转向快，氮气消耗低', description: '起步轻快，转向灵敏，氮气更耐用；弯道是你的主场。', stats: [63, 94, 83] },
  gale: { role: '直道疾风', subtitle: 'GALE / SPEED', skill: '长直冲刺：极速更高，氮气峰值强', description: '更高极速，更强冲刺；提前准备转向，把优势留给直道。', stats: [92, 60, 65] },
  pulse: { role: '漂移蓄能', subtitle: 'PULSE / DRIFT', skill: '漂移回能：小喷更强，道具充能更快', description: '有效漂移出弯能量回收更快，小喷更强；直线极速略低。', stats: [69, 83, 74] },
  bulwark: { role: '抗撞灵活', subtitle: 'BULWARK / CONTACT', skill: '坚韧车身：接触碰撞保留更多速度', description: '接触对手后速度损失更少，弯道灵巧；直线极速略低。', stats: [65, 87, 76] },
};
const app = document.querySelector<HTMLElement>('#app')!;
const routePath = minimapPath(122, 172, 8);
const racePath = minimapPath(136, 196, 12);
app.innerHTML = `
  <div id="viewport"></div>
  <div class="scene-wash" aria-hidden="true"></div>
  <div class="grain" aria-hidden="true"></div>
  <div id="speed-effects" aria-hidden="true"></div>
  <div id="hit-effects" aria-hidden="true"></div>
  <header class="topbar">
    <a class="brand" href="#" aria-label="逐浪飞驰赛事大厅" id="brand-home">
      <span class="brand-mark"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M6 17c5-9 10 9 16 0s10-3 12 0M6 25c5-9 10 9 16 0s10-3 12 0" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg></span>
      <span class="brand-copy">COASTLINE<span>RUSH / ISLAND CLUB</span></span>
    </a>
    <div class="topbar-center"><span class="live-dot"></span><span id="header-status">海岛公路赛 · 单人竞速</span></div>
    <nav class="topbar-actions" aria-label="游戏操作">
      <button class="text-button help-button" data-help>驾驶指南 ${icon('help')}</button>
      <span class="toolbar-divider"></span>
      <button class="icon-button" id="music-button" popovertarget="music-panel" aria-label="音乐与音效设置" title="海岸电台 · 音乐与音效">${icon('music')}</button>
      <button class="icon-button" id="sound-button" aria-label="开启声音" title="声音">${icon('mute')}</button>
      <button class="icon-button quality-button" id="quality-button" aria-label="切换为流畅画质" title="画质：精细">${icon('settings')}</button>
      <button class="icon-button fullscreen-button" id="fullscreen-button" aria-label="进入全屏" title="全屏">${icon('fullscreen')}</button>
      <button class="icon-button pause-button" id="pause-button" aria-label="暂停比赛" title="暂停 · Esc" hidden>${icon('pause')}</button>
    </nav>
  </header>

  <section id="music-panel" class="audio-panel" popover="auto" aria-labelledby="audio-title">
    <div class="audio-panel-heading"><span class="small-label">COASTLINE RADIO</span><button class="icon-button" popovertarget="music-panel" popovertargetaction="hide" aria-label="关闭音乐设置">${icon('close')}</button></div>
    <div class="radio-track"><span class="radio-art">${icon('music')}</span><div><h2 id="audio-title">${MUSIC_TITLE.split(' · ')[0]}</h2><p>电子配乐 <span>· ${MUSIC_BPM} BPM</span></p></div></div>
    <div class="radio-status"><span id="radio-status-dot"></span><span id="radio-status">点击后启用声音</span></div>
    <div class="audio-toggle-row"><span>背景音乐</span><button id="music-toggle" class="audio-toggle" aria-label="背景音乐" aria-pressed="true"><span></span></button></div>
    <label class="audio-range-label" for="music-volume"><span>音乐音量</span><output id="music-volume-value" for="music-volume">40%</output></label>
    <input id="music-volume" class="audio-range" type="range" min="0" max="100" step="1" value="40" aria-label="音乐音量" />
    <label class="audio-range-label" for="effects-volume"><span>引擎与道具音效</span><output id="effects-volume-value" for="effects-volume">80%</output></label>
    <input id="effects-volume" class="audio-range" type="range" min="0" max="100" step="1" value="80" aria-label="音效音量" />
    <p class="audio-panel-tip">比赛加入鼓点，氮气加一层节奏。<br>暂停和切换窗口时，音乐也会暂停。</p>
  </section>

  <section id="menu" aria-label="赛事大厅">
    <div class="menu-copy">
      <p class="eyebrow"><span></span> THE COAST IS CALLING.</p>
      <h1>逐浪<span class="headline-second">飞驰<span class="title-dot">.</span></span></h1>
      <p class="menu-tagline">海风正好，全速出发。</p>
      <p class="menu-description">沿着海岸漂移，用道具漂亮超车。<br>这个夏天，下一道弯属于你。</p>
      <fieldset class="vehicle-selector" aria-describedby="vehicle-description">
        <legend>01 / 选择座驾 <span>五款车型，各有取舍</span></legend>
        <div class="vehicle-options">${VEHICLE_ORDER.map(id => `<label class="vehicle-option" style="--car-color:#${VEHICLES[id].color.toString(16).padStart(6, '0')}"><input type="radio" name="vehicle" value="${id}" aria-label="${VEHICLES[id].name}" ${id === initialVehicle ? 'checked' : ''}/><span class="mini-car" aria-hidden="true"><i></i></span><strong>${VEHICLES[id].name}</strong><small>${vehicleDetails[id].role}</small></label>`).join('')}</div>
        <p id="vehicle-description" aria-live="polite">${vehicleDetails[initialVehicle].description}</p>
      </fieldset>
      <fieldset class="difficulty-selector" aria-describedby="difficulty-description">
        <legend>02 / 挑战难度 <span id="difficulty-subtitle">${DIFFICULTIES[initialDifficulty].subtitle}</span></legend>
        <div class="difficulty-options">${DIFFICULTY_ORDER.map((level, index) => `<label class="difficulty-option" data-tier="${level}" style="--tier-color:${DIFFICULTIES[level].color}"><input type="radio" name="difficulty" value="${level}" aria-label="${DIFFICULTIES[level].label}" ${level === initialDifficulty ? 'checked' : ''}/><span class="tier-bars" aria-hidden="true">${[0, 1, 2].map(bar => `<i class="${bar <= index ? 'is-filled' : ''}"></i>`).join('')}</span><strong>${DIFFICULTIES[level].label}</strong><span class="tier-check" aria-hidden="true">${icon('check')}</span></label>`).join('')}</div>
        <p id="difficulty-description" class="difficulty-description" aria-live="polite">${DIFFICULTIES[initialDifficulty].description}</p>
      </fieldset>
      <div class="menu-actions">
        <button class="primary-button start-button" id="start-button"><span>${icon('flag')} 开始比赛</span>${icon('arrow')}</button>
        <button class="secondary-button" id="online-button">${icon('flag')} 局域网联机</button>
      </div>
      <div class="personal-best">${icon('trophy')}<span id="best-label">简单最佳</span><strong id="personal-best">等待你的第一条纪录</strong></div>
    </div>
    <div class="vehicle-caption"><span class="caption-line"></span><div><span>你的座驾</span><strong id="vehicle-name">${VEHICLES[initialVehicle].name}</strong><small id="vehicle-subtitle">${vehicleDetails[initialVehicle].subtitle}</small><small id="vehicle-skill">${vehicleDetails[initialVehicle].skill}</small><div class="vehicle-stats" id="vehicle-stats"></div></div></div>
    <aside class="race-config" aria-label="赛道与玩法">
      <p class="small-label">RACE SETUP / 赛事配置</p>
      <label>赛道 <select id="track-select">${TRACK_ORDER.map(id => `<option value="${id}">${TRACKS[id].name} · ${TRACKS[id].character}</option>`).join('')}</select></label>
      <p id="track-description">${TRACKS.bay.subtitle}</p>
      <label>玩法 <select id="mode-select"><option value="party">娱乐赛 · 道具与氮气</option><option value="speed">竞速赛 · 纯驾驶</option></select></label>
      <p id="mode-description">后排更容易获得攻击道具和追赶能量。</p>
    </aside>
    <aside class="track-card" aria-label="赛道信息">
      <div class="track-card-map"><svg viewBox="0 0 122 172" role="img" aria-label="赛道轮廓"><path id="lobby-route-shadow" d="${routePath}" class="route-shadow"/><path id="lobby-route-line" d="${routePath}" class="route-line"/><circle id="lobby-route-start" cx="${minimapPoint(0, 122, 172, 8).x}" cy="${minimapPoint(0, 122, 172, 8).y}" r="4" class="route-start"/></svg></div>
      <div class="track-card-info"><p class="small-label">SIX ROUTES</p><h2 id="track-title">晴湾环岛</h2><p id="track-detail" class="track-detail">${TRACKS.bay.subtitle}</p><div class="track-numbers"><span><strong>03</strong> 圈</span><span><strong>06</strong> 车手</span><span><strong id="track-length">${(TRACK_LENGTH / 1000).toFixed(2)}</strong> km</span></div><div class="track-weather">${icon('sun')} 晴空海风 <span>干燥柏油</span></div></div>
    </aside>
    <footer class="menu-footer"><div class="quick-keys"><span><kbd>W A S D</kbd> 驾驶</span><span><kbd id="drift-key-footer">SPACE</kbd> + 方向漂移</span><span><kbd>E</kbd> 使用道具</span></div><span class="footer-motto">FIND YOUR SUMMER. FULL THROTTLE.</span></footer>
  </section>

  <section id="hud" aria-label="比赛仪表" hidden>
    <div class="position-panel"><span class="hud-label">POSITION / 名次</span><div class="position-number"><strong id="rank">6</strong><span>/ 6</span></div><span id="race-difficulty" class="race-tier">简单</span><div id="leaderboard" class="leaderboard"></div></div>
    <div class="race-clock"><div class="lap-pill"><span>第 <strong id="lap">1</strong> 圈</span><span>/ 3</span></div><strong id="race-time">00:00.00</strong><span id="lap-notice">一路向前，抢占内线</span></div>
    <div class="race-minimap"><span class="hud-label" id="hud-track-name">晴湾环岛</span><svg viewBox="0 0 136 196" aria-label="实时赛道小地图"><path id="hud-route-border" d="${racePath}" class="minimap-border"/><path id="hud-route-line" d="${racePath}" class="minimap-track"/><g id="map-dots"></g></svg><span class="map-caption">SIX ROUTES</span></div>
    <div class="item-panel" id="item-panel"><div class="item-box" id="item-icon">${icon('empty')}</div><div class="item-info"><span class="hud-label" id="item-eyebrow">战斗拾取</span><strong id="item-name">寻找补给</strong><span id="item-hint">驶过发光道具箱</span></div><kbd>E</kbd><div class="charge-track"><div id="charge-fill"></div></div></div>
    <div class="drift-indicator" id="drift-indicator" role="meter" aria-label="漂移蓄力" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="drift-meter-top"><strong id="drift-label">按方向 + 漂移键蓄力</strong><output id="drift-percent">0%</output></div><div class="drift-meter-track"><div id="drift-meter-fill"></div></div><small>控角度 · 及时松键出弯小喷</small></div>
    <div class="speed-panel"><div class="speed-ticks" aria-hidden="true">${Array.from({ length: 25 }, (_, i) => `<i style="--tick:${i}"></i>`).join('')}</div><div class="speed-number"><strong id="speed">000</strong><span>KM/H</span></div><div class="nitro-label"><span>${icon('nitro')} 漂移蓄氮</span><kbd id="boost-key-hud">SHIFT</kbd></div><div class="nitro-track"><div id="nitro-fill"></div></div><div class="speed-foot"><span id="drive-status">准备发车</span><span id="energy-label">0%</span></div></div>
    <div class="race-key-hint"><kbd id="drift-key-hud">SPACE</kbd> + 方向漂移 <span>·</span> <kbd>R</kbd> 复位 <span>·</span> <kbd>ESC</kbd> 暂停</div>
    <div class="portrait-hint">横屏驾驶，视野更开阔</div>
    <div id="touch-controls" class="touch-controls" aria-label="触屏驾驶">
      <div class="touch-steering"><button data-control="left" aria-label="左转">${icon('arrowLeft')}</button><button data-control="right" aria-label="右转">${icon('arrow')}</button><button data-control="brake" class="touch-small" aria-label="刹车">刹车</button></div>
      <div class="touch-driving"><button data-control="item" aria-label="使用道具">${icon('rocket')}</button><button data-control="drift" class="touch-small" aria-label="漂移">漂移</button><button data-control="boost" aria-label="氮气加速">${icon('nitro')}</button><button data-control="throttle" class="touch-accelerate" aria-label="油门">油门 ${icon('chevron')}</button></div>
    </div>
  </section>

  <div id="countdown" class="countdown" aria-live="assertive" hidden><span>点燃引擎</span><strong>3</strong><small>按住 W / ↑ 加速</small></div>
  <div id="toast" role="status" class="toast" hidden></div>
  <div id="loading" class="loading"><span class="loading-mark">≈</span><strong>海风正在抵达</strong><span>点燃引擎，准备出发</span><i></i></div>

  <dialog id="help-dialog" class="panel-dialog help-dialog" aria-labelledby="help-title"><button class="dialog-close icon-button" data-close="help-dialog" aria-label="关闭驾驶指南">${icon('close')}</button><p class="eyebrow">THE DRIVER'S HANDBOOK</p><h2 id="help-title">先学会漂移，<br>再学会超越。</h2><div class="help-columns"><div><h3>掌控你的赛车</h3><dl class="control-list"><div><dt><kbd>W</kbd> <kbd>↑</kbd></dt><dd>加速</dd></div><div><dt><kbd>S</kbd> <kbd>↓</kbd></dt><dd>刹车 / 倒车</dd></div><div><dt><kbd>A D</kbd> <kbd>← →</kbd></dt><dd>左右转向</dd></div><div><dt><kbd id="drift-key-help">SPACE</kbd> + 转向</dt><dd>漂移蓄力</dd></div><div><dt><kbd id="boost-key-help">SHIFT</kbd></dt><dd>氮气冲刺</dd></div><div><dt><kbd>E</kbd></dt><dd>使用道具</dd></div><div><dt><kbd>R</kbd> / <kbd>ESC</kbd></dt><dd>赛车复位 / 暂停</dd></div></dl><label class="drift-key-setting" for="drift-key-select"><strong>自定义漂移键</strong><select id="drift-key-select" aria-label="漂移键">${DRIFT_KEY_OPTIONS.map(option => `<option value="${option.code}" ${option.code === initialDriftKey ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label></div><div><h3>把弯道变成武器</h3><p class="help-intro">入弯前减速，按住方向键和漂移键切入。看蓄力条与赛道位置，适时松开触发小喷；回正太晚会冲出赛道。弯道不能靠直行自动通过，复位会退回安全位置。</p><div class="weapon-grid">${Object.entries(ITEMS).map(([key, item]) => `<div class="weapon-guide" style="--item-color:${item.color}">${icon(key)}<div><strong>${item.name}</strong><p>${item.description}</p></div></div>`).join('')}</div></div></div><div class="help-footer"><span>${icon('flag')} 完成三圈，率先冲线。触屏设备支持屏幕按钮。</span><button class="primary-button compact-button" data-close="help-dialog">明白了 ${icon('arrow')}</button></div></dialog>

  <dialog id="pause-dialog" class="panel-dialog pause-dialog" aria-labelledby="pause-title"><p class="eyebrow">TAKE A BREATHER.</p><h2 id="pause-title">海风会等你。</h2><p class="dialog-description">比赛已暂停。准备好了，就回到赛道。</p><p id="pause-difficulty" class="pause-difficulty">简单 · 本场难度</p><div class="pause-actions"><button id="resume-button" class="primary-button">继续比赛 ${icon('play')}</button><button id="restart-button" class="secondary-button">${icon('reset')} 重新开始</button><button id="lobby-button" class="text-button">返回赛事大厅 ${icon('arrow')}</button></div><p class="pause-tip"><kbd>ESC</kbd> 继续比赛</p></dialog>

  <dialog id="results-dialog" class="panel-dialog results-dialog" aria-labelledby="result-title"><div class="result-top"><p class="eyebrow">A LAP TO REMEMBER.</p><span id="result-difficulty" class="result-tier">简单难度</span>${icon('flag')}</div><div class="result-heading"><div><h2 id="result-title">漂亮的一战。</h2><p id="result-subtitle">每一道轮胎印，都是你的轨迹。</p></div><div class="result-position"><strong id="result-rank">1</strong><span>/ 6</span></div></div><div class="result-stats"><div><span>完赛用时</span><strong id="result-time">—</strong></div><div><span>最佳单圈</span><strong id="result-lap">—</strong></div><div><span>有效命中</span><strong id="result-hits">0</strong></div><div><span>漂移次数</span><strong id="result-drifts">0</strong></div></div><div id="result-list" class="result-list"></div><div class="result-actions"><button class="primary-button" id="race-again-button">再飙一场 ${icon('reset')}</button><button class="secondary-button" id="results-lobby-button">返回大厅 ${icon('arrow')}</button></div></dialog>

  <dialog id="lan-dialog" class="panel-dialog lan-dialog" aria-labelledby="lan-title">
    <button class="dialog-close icon-button" id="lan-close" aria-label="关闭联机房间">${icon('close')}</button>
    <p class="eyebrow">SAME WIFI / SAME RACE</p><h2 id="lan-title">和朋友一起跑。</h2>
    <p class="dialog-description">同一局域网内，朋友打开本机 IP 地址并输入房间码。比赛由房主电脑运行。</p>
    <div id="lan-setup">
      <label class="lan-field">你的昵称 <input id="lan-name" maxlength="16" placeholder="输入昵称" value="车手" autocomplete="nickname" /></label>
      <label class="lan-field">房间码 <input id="lan-code" maxlength="6" placeholder="朋友给你的 6 位房间码" autocapitalize="characters" /></label>
      <label class="lan-check"><input id="lan-ai" type="checkbox" checked /> 空位由 AI 补齐（房主选择）</label>
      <div class="lan-actions"><button class="primary-button" id="lan-create">创建房间</button><button class="secondary-button" id="lan-join">加入房间</button></div>
    </div>
    <div id="lan-room" hidden>
      <p class="lan-room-code">房间码 <strong id="lan-room-code"></strong></p>
      <p class="lan-invite">邀请地址 <span id="lan-url"></span></p>
      <label class="lan-check"><input id="lan-ai-room" type="checkbox" /> AI 补齐空位（房主可在开赛前更改）</label>
      <p id="lan-room-config"></p><div id="lan-roster" class="lan-roster"></div>
      <div class="lan-actions"><button class="primary-button" id="lan-start">房主开始比赛</button><button class="secondary-button" id="lan-leave">离开房间</button></div>
    </div>
    <p id="lan-error" class="lan-error" role="status"></p>
  </dialog>
`;

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const simulation = new RaceSimulation(undefined, initialDifficulty, initialVehicle);
simulation.setMode('party');
const lan = new LanClient();
const currentState = (): RaceState => lan.state ?? simulation.state;
const localPlayer = (state = currentState()) => state.racers.find(racer => racer.isPlayer) ?? state.racers[0];
const audio = new GameAudio();
const audioEvents = new AbortController();
let renderer: RaceRenderer;
let previousPhase: GamePhase | null = null;
let toastTimer = 0;
let countdownValue = '';
let goUntil = 0;
let lastUiUpdate = 0;
let lastItem = 'initial';
let currentQuality = true;
let helpPausedRace = false;
const sessionBests = new Map<string, number>();
let previousDifficulty: Difficulty | null = null;
let animationFrame = 0;
let disposed = false;
let previousSoundIcon: boolean | null = null;
let previousMusicIcon: boolean | null = null;

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '—';
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}.${Math.floor((value % 1) * 100).toString().padStart(2, '0')}`;
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
function bestFor(difficulty: Difficulty, vehicle: VehicleId = simulation.state.vehicle) {
  const { track, mode } = simulation.state;
  return Math.min(sessionBests.get(`${difficulty}-${vehicle}-${track}-${mode}`) ?? Infinity,
    readBestTime(progressStorage, difficulty, vehicle, track, mode));
}
function refreshBest() {
  const difficulty = simulation.state.difficulty;
  const best = bestFor(difficulty);
  $('#best-label').textContent = `${TRACKS[simulation.state.track].name} · ${simulation.state.mode === 'speed' ? '竞速' : '娱乐'} · ${DIFFICULTIES[difficulty].label} · ${VEHICLES[simulation.state.vehicle].name}最佳`;
  $('#personal-best').textContent = Number.isFinite(best) ? formatTime(best) : '等待你的第一条纪录';
}
function refreshDifficulty(animate = false) {
  const { difficulty, phase } = simulation.state;
  const profile = DIFFICULTIES[difficulty];
  document.body.dataset.difficulty = difficulty;
  document.body.style.setProperty('--difficulty-color', profile.color);
  document.querySelectorAll<HTMLInputElement>('input[name="difficulty"]').forEach(option => {
    option.checked = option.value === difficulty;
    option.disabled = phase !== 'menu' || lan.connected;
    option.closest('.difficulty-option')?.classList.toggle('is-selected', option.checked);
  });
  $('#difficulty-subtitle').textContent = profile.subtitle;
  $('#difficulty-description').textContent = profile.description;
  $('#race-difficulty').textContent = `${profile.label}难度`;
  $('#pause-difficulty').textContent = `${profile.label} · 本场难度`;
  $('#result-difficulty').textContent = `${profile.label}难度`;
  $('#header-status').textContent = lan.connected ? `${TRACKS[simulation.state.track].name} · 房间 ${lan.code}` : phase === 'menu' ? `${TRACKS[simulation.state.track].name} · ${profile.label}` : phase === 'paused' ? `${profile.label} · 赛事暂停` : phase === 'finished' ? `${profile.label} · 冲线时刻` : `${TRACKS[simulation.state.track].name} · ${profile.label}`;
  refreshBest();
  if (animate && previousDifficulty !== difficulty) {
    gsap.fromTo('#difficulty-description', { opacity: 0.25, y: 4 }, { opacity: 1, y: 0, duration: 0.24, overwrite: true });
  }
  previousDifficulty = difficulty;
}
document.querySelectorAll<HTMLInputElement>('input[name="difficulty"]').forEach(option => {
  option.addEventListener('change', () => {
    if (!isDifficulty(option.value) || !simulation.setDifficulty(option.value)) { refreshDifficulty(); return; }
    saveSelectedDifficulty(progressStorage, option.value);
    refreshDifficulty(true);
    audio.play('click');
  });
});
refreshDifficulty();

function refreshVehicle() {
  const id = simulation.state.vehicle;
  const config = VEHICLES[id];
  document.body.dataset.vehicle = id;
  document.querySelectorAll<HTMLInputElement>('input[name="vehicle"]').forEach(option => {
    option.checked = option.value === id;
    option.disabled = simulation.state.phase !== 'menu' || lan.connected;
    option.closest('.vehicle-option')?.classList.toggle('is-selected', option.checked);
  });
  $('#vehicle-name').textContent = config.name;
  $('#vehicle-subtitle').textContent = vehicleDetails[id].subtitle;
  $('#vehicle-skill').textContent = vehicleDetails[id].skill;
  $('#vehicle-description').textContent = vehicleDetails[id].description;
  $('#vehicle-stats').innerHTML = ['极速', '操控', '起步'].map((label, i) => `<span>${label}<i><b style="width:${vehicleDetails[id].stats[i]}%"></b></i></span>`).join('');
  refreshBest();
}
document.querySelectorAll<HTMLInputElement>('input[name="vehicle"]').forEach(option => {
  option.addEventListener('change', () => {
    if (isVehicle(option.value) && simulation.setVehicle(option.value)) {
      saveSelectedVehicle(progressStorage, option.value);
      audio.play('click');
    }
    refreshVehicle();
  });
});
refreshVehicle();

function refreshRaceConfig() {
  const { track, mode } = simulation.state;
  $<HTMLSelectElement>('#track-select').value = track;
  $<HTMLSelectElement>('#mode-select').value = mode;
  $<HTMLSelectElement>('#track-select').disabled = lan.connected;
  $<HTMLSelectElement>('#mode-select').disabled = lan.connected;
  $('#track-description').textContent = TRACKS[track].subtitle;
  $('#mode-description').textContent = mode === 'speed'
    ? '无道具箱、无氮气；靠走线与出弯小喷决胜。'
    : '后排更容易获得攻击道具和追赶能量。';
  $('#track-title').textContent = TRACKS[track].name;
  $('#track-detail').textContent = TRACKS[track].subtitle;
  $('#track-length').textContent = (TRACK_LENGTH / 1000).toFixed(2);
  $('#hud-track-name').textContent = TRACKS[track].name;
  const lobbyPath = minimapPath(122, 172, 8), hudPath = minimapPath(136, 196, 12);
  $('#lobby-route-shadow').setAttribute('d', lobbyPath);
  $('#lobby-route-line').setAttribute('d', lobbyPath);
  $('#hud-route-border').setAttribute('d', hudPath);
  $('#hud-route-line').setAttribute('d', hudPath);
  const start = minimapPoint(0, 122, 172, 8);
  $('#lobby-route-start').setAttribute('cx', String(start.x));
  $('#lobby-route-start').setAttribute('cy', String(start.y));
  $('#item-panel').hidden = mode === 'speed';
  $('.nitro-label').hidden = mode === 'speed';
  $('.nitro-track').hidden = mode === 'speed';
  $('#energy-label').hidden = mode === 'speed';
  $('[data-control="item"]').hidden = mode === 'speed';
  $('[data-control="boost"]').hidden = mode === 'speed';
  refreshDifficulty();
  refreshBest();
}
$<HTMLSelectElement>('#track-select').addEventListener('change', event => {
  const id = (event.target as HTMLSelectElement).value;
  if (!isTrackId(id) || !simulation.setTrack(id)) return;
  if (renderer) {
    renderer.dispose();
    renderer = new RaceRenderer($('#viewport'));
    renderer.setQuality(currentQuality);
    simulation.setStaticColliders(renderer.staticColliders);
    renderer.update(simulation.state, 0.016);
  }
  refreshRaceConfig();
  audio.play('click');
});
$<HTMLSelectElement>('#mode-select').addEventListener('change', event => {
  const mode = (event.target as HTMLSelectElement).value as RaceMode;
  if (!simulation.setMode(mode)) return;
  refreshRaceConfig();
  audio.play('click');
});
refreshRaceConfig();

let lanAddress = location.origin + '/';
let lastNetworkSerial = 0;
let lastRoomSignature = '';
const lanDialog = $<HTMLDialogElement>('#lan-dialog');
function renderLanRoom() {
  const room = lan.room;
  const signature = room ? [lanAddress, lan.playerId, room.code, room.track, room.mode, room.difficulty,
    room.fillAI, room.started, ...room.drivers.map(driver => `${driver.id}:${driver.name}:${driver.vehicle}`)].join('|') : 'none';
  if (signature === lastRoomSignature) return;
  lastRoomSignature = signature;
  refreshVehicle();
  refreshDifficulty();
  $<HTMLButtonElement>('#start-button').disabled = !!room;
  $('#online-button').textContent = room ? '返回联机房间' : '局域网联机';
  $<HTMLSelectElement>('#track-select').disabled = !!room;
  $<HTMLSelectElement>('#mode-select').disabled = !!room;
  $('#lan-setup').hidden = !!room;
  $('#lan-room').hidden = !room;
  if (!room) return;
  if (simulation.state.phase === 'menu' && simulation.state.track !== room.track) {
    simulation.setTrack(room.track);
    if (renderer) {
      renderer.dispose();
      renderer = new RaceRenderer($('#viewport'));
      renderer.setQuality(currentQuality);
      simulation.setStaticColliders(renderer.staticColliders);
    }
  }
  if (simulation.state.phase === 'menu') {
    if (simulation.state.mode !== room.mode) simulation.setMode(room.mode);
    if (simulation.state.difficulty !== room.difficulty) simulation.setDifficulty(room.difficulty);
    refreshRaceConfig();
  }
  $('#lan-room-code').textContent = room.code;
  $('#lan-url').textContent = `${lanAddress}?room=${room.code}`;
  $('#lan-room-config').textContent = `${TRACKS[room.track].name} · ${room.mode === 'speed' ? '纯竞速' : '娱乐道具'} · ${room.fillAI ? 'AI 补位' : '只和朋友比赛'}`;
  $<HTMLInputElement>('#lan-ai-room').checked = room.fillAI;
  $<HTMLInputElement>('#lan-ai-room').disabled = !lan.host || room.started;
  $('#lan-roster').innerHTML = room.drivers.map(driver => `<div><strong>${driver.id + 1}. ${escapeHtml(driver.name)}</strong><span>${VEHICLES[driver.vehicle].name}${driver.id === 0 ? ' · 房主' : ''}</span></div>`).join('');
  $<HTMLButtonElement>('#lan-start').hidden = !lan.host || room.started;
  $<HTMLButtonElement>('#lan-start').disabled = room.drivers.length < 2 && !room.fillAI;
  if (room.started) {
    if (lanDialog.open) lanDialog.close();
  }
}
lan.onChange = renderLanRoom;
lan.onError = message => { $('#lan-error').textContent = message; };
async function openLan() {
  $('#lan-error').textContent = '';
  if (!lanDialog.open) lanDialog.showModal();
  try {
    const response = await fetch('/api/health');
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error();
    const health = await response.json() as { lanUrls?: string[] };
    lanAddress = health.lanUrls?.[0] ?? location.origin + '/';
  } catch {
    $('#lan-error').textContent = '请先运行 npm run lan，再打开终端显示的局域网地址。';
  }
  renderLanRoom();
}
$('#online-button').addEventListener('click', () => { void openLan(); });
$('#lan-close').addEventListener('click', () => lanDialog.close());
$('#lan-create').addEventListener('click', async () => {
  $('#lan-error').textContent = '';
  try {
    await lan.create({
      name: $<HTMLInputElement>('#lan-name').value, vehicle: simulation.state.vehicle,
      track: simulation.state.track, mode: simulation.state.mode,
      difficulty: simulation.state.difficulty, fillAI: $<HTMLInputElement>('#lan-ai').checked,
    });
    history.replaceState(null, '', `?room=${lan.code}`);
  } catch (error) { $('#lan-error').textContent = error instanceof Error ? error.message : '创建房间失败'; }
});
$('#lan-join').addEventListener('click', async () => {
  $('#lan-error').textContent = '';
  try {
    await lan.join($<HTMLInputElement>('#lan-code').value, $<HTMLInputElement>('#lan-name').value, simulation.state.vehicle);
    history.replaceState(null, '', `?room=${lan.code}`);
  } catch (error) { $('#lan-error').textContent = error instanceof Error ? error.message : '加入房间失败'; }
});
$('#lan-start').addEventListener('click', async () => {
  $('#lan-error').textContent = '';
  try { await lan.start(); }
  catch (error) { $('#lan-error').textContent = error instanceof Error ? error.message : '开赛失败'; }
});
$('#lan-ai-room').addEventListener('change', async () => {
  try { await lan.setFillAI($<HTMLInputElement>('#lan-ai-room').checked); }
  catch (error) { $('#lan-error').textContent = error instanceof Error ? error.message : '更新房间设置失败'; renderLanRoom(); }
});
$('#lan-leave').addEventListener('click', () => { void lan.leave(); history.replaceState(null, '', '/'); });

function updateSound() {
  if (previousSoundIcon !== audio.muted) {
    previousSoundIcon = audio.muted;
    $('#sound-button').innerHTML = icon(audio.muted ? 'mute' : 'volume');
  }
  $('#sound-button').setAttribute('aria-label', audio.muted ? '开启声音' : '静音');
  $('#sound-button').setAttribute('aria-pressed', String(!audio.muted));
  $('#sound-button').title = audio.muted ? '开启声音' : '静音';
  const musicOn = audio.musicEnabled && audio.musicVolume > 0;
  if (previousMusicIcon !== musicOn) {
    previousMusicIcon = musicOn;
    $('#music-button').innerHTML = icon(musicOn ? 'music' : 'musicOff');
  }
  $('#music-toggle').setAttribute('aria-pressed', String(audio.musicEnabled));
  $<HTMLInputElement>('#music-volume').value = String(Math.round(audio.musicVolume * 100));
  $<HTMLInputElement>('#effects-volume').value = String(Math.round(audio.effectsVolume * 100));
  $('#music-volume-value').textContent = `${Math.round(audio.musicVolume * 100)}%`;
  $('#effects-volume-value').textContent = `${Math.round(audio.effectsVolume * 100)}%`;
  const snapshot = audio.snapshot;
  const quiet = snapshot.music?.mode === 'paused' || snapshot.music?.mode === 'hidden';
  $('#radio-status').textContent = snapshot.contextState === 'locked' ? '点击后启用声音' : audio.muted ? '总声音已静音' : !audio.musicEnabled ? '背景音乐已关闭' : audio.musicVolume === 0 ? '音乐音量为零' : quiet ? '音乐已暂停' : simulation.state.phase === 'racing' ? '正在播放 · 全速版' : '正在播放 · 巡航版';
  $('#radio-status-dot').classList.toggle('is-playing', snapshot.contextState === 'running' && !audio.muted && audio.musicEnabled && audio.musicVolume > 0 && !quiet);
}
updateSound();

function unlockAudio() { void audio.unlock().then(updateSound); }
// Browser policy requires a real gesture. Opening the page never starts audible playback.
document.addEventListener('pointerdown', event => {
  if (!(event.target instanceof Element) || !event.target.closest('#sound-button')) unlockAudio();
}, { once: true, signal: audioEvents.signal });
document.addEventListener('keydown', unlockAudio, { once: true, signal: audioEvents.signal });
window.addEventListener('blur', () => { audio.setFocused(false); updateSound(); }, { signal: audioEvents.signal });
window.addEventListener('focus', () => { audio.setFocused(true); updateSound(); }, { signal: audioEvents.signal });

function closeDialogs() {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
  helpPausedRace = false;
}
function requestPause(reason: 'keyboard' | 'blur' = 'blur') {
  if (lan.connected) {
    if (reason === 'blur') input.clear();
    else showToast('联机比赛无法暂停；按键松开后可继续驾驶');
    return;
  }
  if (reason === 'keyboard') {
    if ($('#music-panel').matches(':popover-open')) { $('#music-panel').hidePopover(); return; }
    if ($<HTMLDialogElement>('#help-dialog').open) { closeHelp(); return; }
    if (simulation.state.phase === 'paused') { resumeRace(); return; }
    if (simulation.state.phase === 'finished') { returnToMenu(); return; }
  }
  if (simulation.state.phase !== 'racing' && simulation.state.phase !== 'countdown') return;
  simulation.pause(); input.clear();
  if (!$('#help-dialog').hasAttribute('open')) $('#pause-dialog').hasAttribute('open') || $<HTMLDialogElement>('#pause-dialog').showModal();
}
const input = new GameInput(requestPause);
input.setDriftKey(initialDriftKey);
function updateDriftKeyLabels() {
  const driftLabel = displayDriftKey(input.selectedDriftKey);
  const boostLabel = input.selectedDriftKey === 'ShiftLeft' ? 'SPACE' : 'SHIFT';
  for (const id of ['#drift-key-footer', '#drift-key-hud', '#drift-key-help']) $(id).textContent = driftLabel;
  for (const id of ['#boost-key-hud', '#boost-key-help']) $(id).textContent = boostLabel;
}
updateDriftKeyLabels();
$<HTMLSelectElement>('#drift-key-select').addEventListener('change', event => {
  if (!input.setDriftKey((event.target as HTMLSelectElement).value)) return;
  saveDriftKey(progressStorage, input.selectedDriftKey);
  updateDriftKeyLabels();
});
input.bindTouch($('#touch-controls'));

function resumeRace() {
  $<HTMLDialogElement>('#pause-dialog').close();
  input.clear(); simulation.resume(); audio.unlock().catch(() => undefined);
}
function startRace() {
  if (lan.connected) return;
  closeDialogs(); input.clear();
  window.clearTimeout(toastTimer);
  $('#toast').hidden = true;
  goUntil = 0;
  audio.unlock().catch(() => undefined);
  audio.play('click');
  countdownValue = ''; lastItem = 'initial';
  $('#countdown small').textContent = '按住 W / ↑ 加速';
  simulation.start();
  ($('#start-button') as HTMLButtonElement).blur();
}
function returnToMenu() {
  if (lan.connected) { void lan.leave(); history.replaceState(null, '', '/'); }
  closeDialogs(); input.clear(); simulation.returnToMenu();
  $('#countdown').hidden = true; $('#toast').hidden = true;
}
function openHelp() {
  helpPausedRace = !lan.connected && (simulation.state.phase === 'racing' || simulation.state.phase === 'countdown');
  if (helpPausedRace) { simulation.pause(); input.clear(); }
  $<HTMLDialogElement>('#help-dialog').showModal();
  audio.play('click');
}
function closeHelp() {
  $<HTMLDialogElement>('#help-dialog').close();
  input.clear();
  if (helpPausedRace) { simulation.resume(); helpPausedRace = false; }
}

$('#start-button').addEventListener('click', startRace);
$('#resume-button').addEventListener('click', resumeRace);
$('#restart-button').addEventListener('click', startRace);
$('#race-again-button').addEventListener('click', startRace);
$('#lobby-button').addEventListener('click', returnToMenu);
$('#results-lobby-button').addEventListener('click', returnToMenu);
$('#pause-button').addEventListener('click', () => requestPause());
$('#brand-home').addEventListener('click', event => { event.preventDefault(); if (simulation.state.phase === 'racing' || simulation.state.phase === 'countdown') requestPause(); else if (simulation.state.phase === 'finished') returnToMenu(); });
document.querySelectorAll('[data-help]').forEach(button => button.addEventListener('click', openHelp));
document.querySelectorAll<HTMLElement>('[data-close]').forEach(button => button.addEventListener('click', () => button.dataset.close === 'help-dialog' ? closeHelp() : $<HTMLDialogElement>(`#${button.dataset.close}`).close()));
$<HTMLDialogElement>('#help-dialog').addEventListener('cancel', event => { event.preventDefault(); closeHelp(); });
$<HTMLDialogElement>('#pause-dialog').addEventListener('cancel', event => { event.preventDefault(); resumeRace(); });
$<HTMLDialogElement>('#results-dialog').addEventListener('cancel', event => { event.preventDefault(); returnToMenu(); });
$('#sound-button').addEventListener('click', () => {
  audio.setMuted(!audio.muted); unlockAudio(); updateSound();
  if (!audio.muted) audio.play('click');
});
$('#music-button').addEventListener('click', unlockAudio);
$('#music-toggle').addEventListener('click', () => {
  audio.setMusicEnabled(!audio.musicEnabled); unlockAudio(); updateSound();
});
$('#music-volume').addEventListener('input', () => {
  audio.setMusicVolume(Number($<HTMLInputElement>('#music-volume').value) / 100); updateSound();
});
$('#effects-volume').addEventListener('input', () => {
  audio.setEffectsVolume(Number($<HTMLInputElement>('#effects-volume').value) / 100); updateSound();
});
$('#quality-button').addEventListener('click', () => {
  currentQuality = !currentQuality; renderer?.setQuality(currentQuality);
  $('#quality-button').setAttribute('aria-label', `切换为${currentQuality ? '流畅' : '精细'}画质`);
  $('#quality-button').title = `画质：${currentQuality ? '精细' : '流畅'}`;
  showToast(`${currentQuality ? '精细' : '流畅'}画质已启用`);
});
$('#fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { showToast('当前浏览器不支持全屏，请尝试最大化窗口'); }
});
document.addEventListener('fullscreenchange', () => $('#fullscreen-button').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) requestPause();
  audio.setFocused(!document.hidden && document.hasFocus()); updateSound();
}, { signal: audioEvents.signal });

function showToast(text: string) {
  window.clearTimeout(toastTimer);
  const toast = $('#toast'); toast.textContent = text; toast.hidden = false;
  gsap.fromTo(toast, { y: -10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, overwrite: true });
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2600);
}

function showResults() {
  const state = currentState();
  const player = localPlayer(state);
  const difficulty = state.difficulty;
  $('#result-rank').textContent = String(player.rank);
  $('.result-position span').textContent = `/ ${state.racers.filter(racer => racer.active !== false).length}`;
  $('#result-title').textContent = player.rank === 1 ? '整片海岸，为你喝彩。' : player.rank <= 3 ? '漂亮的一战。' : '下一次，冲得更远。';
  $('#result-subtitle').textContent = player.rank === 1 ? '把海风与对手，一起留在身后。' : '每一道轮胎印，都是你的轨迹。';
  $('#result-time').textContent = formatTime(player.finishTime || state.time);
  $('#result-lap').textContent = state.bestLap > 0 ? formatTime(state.bestLap) : '—';
  $('#result-hits').textContent = String(state.hits);
  $('#result-drifts').textContent = String(state.drifts);
  $('#result-list').innerHTML = [...state.racers].filter(r => r.active !== false).sort((a, b) => a.rank - b.rank).map(r => `<div class="result-row ${r.isPlayer ? 'is-you' : ''}"><span>${String(r.rank).padStart(2, '0')}</span><i style="background:#${r.color.toString(16).padStart(6, '0')}"></i><strong>${escapeHtml(r.name)}${r.isPlayer ? '<small>你</small>' : ''}</strong><span>${r.finished ? formatTime(r.finishTime) : '未冲线'}</span></div>`).join('');
  const finishTime = player.finishTime || state.time;
  if (Number.isFinite(finishTime) && finishTime > 0 && finishTime < bestFor(difficulty)) {
    sessionBests.set(`${difficulty}-${state.vehicle}-${state.track}-${state.mode}`, finishTime);
    const saved = saveBestTime(progressStorage, difficulty, finishTime, state.vehicle, state.track, state.mode);
    refreshBest();
    $('#result-subtitle').textContent = saved ? `${DIFFICULTIES[difficulty].label}新纪录。你的极限，刚刚被改写。` : `${DIFFICULTIES[difficulty].label}新纪录 · 当前浏览器未能保存`;
  }
  $<HTMLDialogElement>('#results-dialog').showModal();
  gsap.fromTo('#results-dialog', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' });
}

function syncPhase(now: number) {
  const phase = currentState().phase;
  if (phase === previousPhase) return;
  const was = previousPhase;
  previousPhase = phase;
  audio.setPhase(phase);
  updateSound();
  document.body.dataset.phase = phase;
  refreshDifficulty();
  refreshVehicle();
  const menu = phase === 'menu';
  $('#menu').hidden = !menu; $('#hud').hidden = menu;
  if (menu) $('#speed-effects').style.opacity = '0';
  $('#pause-button').hidden = menu || phase === 'finished' || lan.connected;
  $('#restart-button').hidden = lan.connected;
  $('#race-again-button').hidden = lan.connected;
  if (menu) {
    gsap.fromTo('.menu-copy > *, .track-card, .vehicle-caption', { y: 18, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.065, duration: 0.75, ease: 'power3.out', overwrite: true });
    // Keep the footer's touch/key hints inside the viewport throughout the entrance.
    gsap.fromTo('.menu-footer', { y: 0, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, overwrite: true });
  }
  if (phase === 'countdown' && was !== 'paused') gsap.fromTo('#hud', { opacity: 0 }, { opacity: 1, duration: 0.65 });
  if (phase === 'racing' && was === 'countdown') {
    goUntil = now + 1100; $('#countdown').hidden = false;
    $('#countdown strong').textContent = 'GO!'; $('#countdown span').textContent = '把对手留在身后';
    $('#countdown small').textContent = ''; audio.play('go');
    gsap.fromTo('#countdown strong', { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3 });
  }
  if (phase === 'finished') { $('#countdown').hidden = true; input.clear(); showResults(); }
}

function handleEvent(event: GameEvent) {
  const playerId = localPlayer().id;
  renderer.event(event, currentState());
  if (event.type === 'hit' && event.racer !== playerId && event.other === playerId) {
    audio.play('hit');
    showToast('直接命中 · 打开超车窗口');
  }
  if (event.racer !== playerId || event.type === 'countdown') return;
  audio.play(event.type);
  if (event.type === 'collision') {
    if (event.text === 'PROJECTILE_BLOCKED') showToast('火箭击中障碍物');
    else if ((event.strength ?? 0) > 0.28) showToast(event.collisionKind === 'car' ? '车身碰撞 · 稳住方向' : event.collisionKind === 'barrier' ? '擦碰护栏 · 松开转向' : '撞到障碍 · 倒车或按 R 复位');
  }
  if (event.type === 'pickup' && event.item) showToast(`已拾取 · ${ITEMS[event.item].name}　按 E 使用`);
  if (event.type === 'hit') {
    showToast('遭到攻击 · 短暂保护已生效');
    gsap.fromTo('#hit-effects', { opacity: 0.7 }, { opacity: 0, duration: 0.65 });
  }
  if (event.type === 'lap') showToast(event.text || `第 ${localPlayer().lap} 圈 · 继续冲刺`);
  if (event.type === 'reset') showToast('退回安全位置 · 用方向键和漂移键过弯');
  if (event.type === 'drift') showToast(event.text === 'DOUBLE SPRAY!'
    ? '双喷成功 · 再次提速' : event.text === 'DRIFT MISS'
      ? '漂移角度不足或按得太久 · 下个弯提早松开' : event.text?.startsWith('PERFECT')
        ? '完美漂移 · 强力小喷！再点 W 可双喷' : '出弯小喷！松开再点 W 可双喷');
}

function updateUI(now: number) {
  const state = currentState();
  const player = localPlayer(state);
  if (state.phase === 'countdown') {
    const value = String(Math.max(1, Math.ceil(state.countdown)));
    $('#countdown').hidden = false;
    if (value !== countdownValue) {
      countdownValue = value;
      $('#countdown strong').textContent = value;
      $('#countdown span').textContent = '点燃引擎';
      audio.play('countdown');
      gsap.fromTo('#countdown strong', { scale: 1.3, opacity: 0.3 }, { scale: 1, opacity: 1, duration: 0.38, ease: 'power3.out' });
    }
  } else if (state.phase !== 'paused' && now > goUntil) $('#countdown').hidden = true;
  if (state.phase === 'menu') return;
  $('#speed-effects').style.opacity = player.boostTime > 0 ? '0.6' : '0';
  if (now - lastUiUpdate < 65) return;
  lastUiUpdate = now;
  $('#rank').textContent = String(player.rank);
  $('.position-number span').textContent = `/ ${state.racers.filter(racer => racer.active !== false).length}`;
  $('#lap').textContent = String(Math.min(3, Math.max(1, player.lap)));
  $('#race-time').textContent = formatTime(state.time);
  $('#speed').textContent = String(Math.round(Math.abs(player.speed) * 3.6)).padStart(3, '0');
  $('.speed-panel').style.setProperty('--speed', String(Math.min(Math.abs(player.speed) / 78, 1)));
  $('#nitro-fill').style.width = `${Math.max(0, Math.min(100, player.energy))}%`;
  $('#energy-label').textContent = `${Math.round(player.energy)}%`;
  $('#drive-status').textContent = player.finished && state.phase === 'racing' ? '已冲线 · 等待其他车手' : player.hitTime > 0 ? '受到攻击' : player.collisionTime > 0 ? '车身碰撞 · 稳住方向' : Math.abs(player.lateral) > 9.5 ? '沙滩 · 抓地力下降' : player.driftTime > 0.1 ? '漂移中 · 控制角度' : player.boostTime > 0 ? state.mode === 'speed' ? '出弯小喷' : '喷射加速' : player.shield > 0 ? '护盾保护中' : player.speed < -1 ? '倒车中' : player.speed > 1 ? '全速向前' : '按 W 加速';
  $('#lap-notice').textContent = player.finished ? `你的用时 ${formatTime(player.finishTime)}` : player.lap === 3 ? '最后一圈 · 放手一搏' : state.bestLap > 0 && Number.isFinite(state.bestLap) ? `最佳单圈 ${formatTime(state.bestLap)}` : '一路向前，抢占内线';
  $('#leaderboard').innerHTML = [...state.racers].filter(r => r.active !== false).sort((a, b) => a.rank - b.rank).map(r => `<div class="leader-row ${r.isPlayer ? 'is-you' : ''}"><span>${r.rank}</span><i style="background:#${r.color.toString(16).padStart(6, '0')}"></i><strong>${escapeHtml(r.name)}</strong>${r.isPlayer ? '<small>YOU</small>' : ''}</div>`).join('');
  $('#map-dots').innerHTML = [...state.racers].filter(r => r.active !== false).reverse().map(r => { const point = minimapPoint(r.distance, 136, 196, 12); return `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${r.isPlayer ? 4.7 : 3}" fill="${r.isPlayer ? '#1f9caa' : '#f9f0da'}" stroke="${r.isPlayer ? '#fff2d6' : '#303b39'}" stroke-width="1.5"/>`; }).join('');
  const itemKey = `${player.item}-${player.charge >= 0.99}`;
  if (itemKey !== lastItem) {
    lastItem = itemKey;
    const data = player.item ? ITEMS[player.item] : null;
    $('#item-panel').style.setProperty('--item-color', data?.color ?? '#d6cfbb');
    $('#item-panel').classList.toggle('has-item', !!data);
    $('#item-panel').classList.toggle('is-powered', player.charge >= 0.99 && !!data);
    $('#item-icon').innerHTML = icon(player.item ?? 'empty');
    $('#item-name').textContent = data ? data.name : '寻找补给';
    $('#item-hint').textContent = data ? player.charge >= 0.99 ? '已强化 · 按 E 释放' : '按 E 使用 · 漂移可强化' : '驶过发光道具箱';
    $('#item-eyebrow').textContent = data ? player.charge >= 0.99 ? 'OVERCHARGED / 强化' : 'READY TO FIRE / 就绪' : '战斗拾取';
    if (data) gsap.fromTo('#item-icon', { scale: 0.8, rotate: -8 }, { scale: 1, rotate: 0, duration: 0.4, ease: 'back.out(2)' });
  }
  $('#charge-fill').style.width = `${Math.min(player.charge, 1) * 100}%`;
  const driftPercent = player.driftReady > 0 ? 100 : Math.min(100, Math.round(player.driftScore / 0.68 * 100));
  $('#drift-meter-fill').style.width = `${driftPercent}%`;
  $('#drift-indicator').setAttribute('aria-valuenow', String(driftPercent));
  $('#drift-percent').textContent = `${driftPercent}%`;
  $('#drift-indicator').classList.toggle('is-ready', player.driftReady > 0);
  $('#drift-label').textContent = player.driftReady > 0 ? '小喷成功 · 松开再点油门双喷'
    : player.driftTime > 1.65 ? '漂移过久 · 尽快回正'
    : player.driftTime > 0 ? driftPercent >= 80 ? '满蓄力 · 松键出弯' : '漂移蓄力中 · 看准出弯'
    : '按方向 + 漂移键蓄力';
}

try {
  renderer = new RaceRenderer($('#viewport'));
  simulation.setStaticColliders(renderer.staticColliders);
  let lastTime = performance.now();
  function frame(now: number) {
    if (disposed) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const controls = input.read();
    if (lan.connected) {
      lan.setInput(controls);
      if (lan.serial !== lastNetworkSerial && lan.state) {
        lastNetworkSerial = lan.serial;
        for (const event of lan.events) handleEvent(event);
      }
    } else {
      simulation.update(dt, controls);
      for (const event of simulation.state.events) handleEvent(event);
    }
    syncPhase(now);
    renderer.update(currentState(), dt);
    updateUI(now);
    const player = localPlayer();
    audio.update(player.speed, player.boostTime > 0, player.driftTime > 0.15, currentState().phase === 'racing');
    animationFrame = requestAnimationFrame(frame);
  }
  renderer.update(simulation.state, 0.016);
  gsap.to('#loading', { opacity: 0, duration: 0.45, delay: 0.2, onComplete: () => { $('#loading').hidden = true; } });
  animationFrame = requestAnimationFrame(frame);
  const inviteCode = new URLSearchParams(location.search).get('room')?.toUpperCase();
  if (inviteCode) {
    $<HTMLInputElement>('#lan-code').value = inviteCode;
    lan.restore(inviteCode);
    void openLan();
  }
  if (import.meta.env.DEV) {
    Object.defineProperty(window, '__RALLY__', { value: { simulation, renderer, input, audio, startRace, returnToMenu }, configurable: true });
  }
} catch (error) {
  console.error(error);
  $('#loading').innerHTML = `<span class="loading-mark">≈</span><strong>引擎暂时无法启动</strong><span>请使用支持 WebGL 2 的新版 Chrome、Edge 或 Safari，并开启硬件加速。</span><button class="primary-button" id="reload-button">重新加载 ${icon('reset')}</button>`;
  $('#reload-button').addEventListener('click', () => location.reload());
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  disposed = true;
  cancelAnimationFrame(animationFrame);
  window.clearTimeout(toastTimer);
  gsap.globalTimeline.clear();
  audioEvents.abort();
  input.dispose(); audio.dispose(); renderer?.dispose();
  lan.close();
});
