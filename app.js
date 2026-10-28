// «АУКЦИОН» — Басты қосымша контроллері (Application Controller)
import { StorageManager } from './storage.js';
import { sounds } from './soundEngine.js';
import { GameEngine, GamePhase } from './gameState.js';
import { AVAILABLE_COLORS } from './defaultData.js';

class AuctionApp {
  constructor() {
    this.data = StorageManager.load();
    this.engine = new GameEngine(this.data, (updatedData, triggerSave) => {
      this.data = updatedData;
      if (triggerSave) {
        StorageManager.save(this.data);
      }
      this.render();
    });

    this.confettiRunning = false;
    this.confettiParticles = [];
    this.bidderUrl = null;
    this.currentGlobalStep = Number(this.data.settings.minBidStep) || 100;
  }

  async init() {
    // Сақталған стильді (Жарық/Қараңғы) қолдану
    const savedTheme = localStorage.getItem('AUCTION_THEME');
    if (savedTheme === 'dark') {
      document.body.classList.add('dark-theme');
    }

    // Дыбысты баптау
    sounds.setEnabled(this.data.settings.soundEnabled);

    // Алғашқы қолданушы басқанда Web Audio API-ді белсендіру
    const unlockAudio = () => {
      sounds.init();
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    this.bindGlobalEvents();
    this.initPhoneSync();
    this.render();
    this.showToast('«АУКЦИОН» жүйесі сәтті жүктелді!', 'info');
  }

  async initPhoneSync() {
    try {
      const resp = await fetch('/api/info');
      if (resp.ok) {
        const info = await resp.json();
        this.bidderUrl = info.bidderUrl;
      }
    } catch (e) {
      this.bidderUrl = window.location.origin + '/bidder.html';
    }

    try {
      const evtSource = new EventSource('/api/events');
      evtSource.addEventListener('incoming_bid', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && data.teamId) {
            const res = this.engine.placeBid(data.teamId, null, data.delta);
            if (res.success) {
              sounds.playBid();
              this.broadcastStateToPhones();
            }
          }
        } catch (err) {}
      });
    } catch (e) {}

    try {
      const bc = new BroadcastChannel('AUCTION_SYNC_CHANNEL');
      bc.onmessage = (e) => {
        if (e.data && e.data.type === 'INCOMING_BID') {
          const res = this.engine.placeBid(e.data.teamId, null, e.data.delta);
          if (res.success) {
            sounds.playBid();
            this.broadcastStateToPhones();
          }
        }
      };
    } catch (e) {}
  }

  broadcastStateToPhones() {
    const lot = this.engine.getCurrentLot();
    const leadingTeam = this.engine.getLeadingTeam();
    const payload = {
      currentLot: lot ? { lotNumber: lot.lotNumber, title: lot.title } : null,
      currentBid: this.engine.state.currentBid,
      leadingTeamId: this.engine.state.leadingTeamId,
      leadingTeamName: leadingTeam ? leadingTeam.name : null,
      leadingTeamColor: leadingTeam ? leadingTeam.color : null,
      teams: this.data.teams
    };

    try {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (e) {}

    try {
      const bc = new BroadcastChannel('AUCTION_SYNC_CHANNEL');
      bc.postMessage({ type: 'STATE_SYNC', payload });
      bc.close();
    } catch (e) {}
  }

  openPhoneQRModal() {
    const modal = document.getElementById('phone-qr-modal');
    const canvas = document.getElementById('projector-qr-canvas');
    const linkText = document.getElementById('projector-qr-link-text');
    if (!modal) return;

    const targetUrl = this.bidderUrl || (window.location.origin + '/bidder.html');
    if (linkText) linkText.textContent = targetUrl;
    if (canvas && window.renderQRCode) {
      window.renderQRCode(canvas, targetUrl, { size: 240 });
    }

    modal.classList.add('active');
  }

  // --------------------------------------------------------------------------
  // UI РЕНДЕРИНГІ
  // --------------------------------------------------------------------------
  render() {
    this.renderHeader();
    this.renderMainContent();
    this.renderSidebar();
    this.broadcastStateToPhones();
  }
    this.renderSidebar();
  }

  renderHeader() {
    const lot = this.engine.getCurrentLot();
    const totalLots = this.data.questions.length;
    const currentNum = lot ? lot.lotNumber : totalLots;

    const roundIndicator = document.getElementById('round-indicator');
    if (roundIndicator) {
      roundIndicator.innerHTML = `
        <span class="status-dot"></span>
        Сұрақ: <strong>${currentNum} / ${totalLots}</strong>
      `;
    }

    const soundBtn = document.getElementById('btn-sound-toggle');
    if (soundBtn) {
      soundBtn.innerHTML = this.data.settings.soundEnabled
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>';
      soundBtn.title = this.data.settings.soundEnabled ? 'Дыбыс қосулы' : 'Дыбыс өшірулі';
    }
  }

  renderMainContent() {
    const stageContainer = document.getElementById('main-stage-container');
    if (!stageContainer) return;

    const lot = this.engine.getCurrentLot();
    const phase = this.engine.state.phase;

    // 1. Егер ойын аяқталса — Марапаттау тұғырын көрсету
    if (phase === GamePhase.GAME_OVER || !lot) {
      stageContainer.innerHTML = this.getPodiumHTML();
      this.triggerConfetti();
      sounds.playVictory();
      this.bindPodiumEvents();
      return;
    }

    const currentNum = this.engine.state.currentLotIndex + 1;

    let html = '';

    // 3. Фазаға сәйкес блок: Немесе Бәссауда Аренасы, немесе Сұрақ Аренасы
    if (phase === GamePhase.QUESTION_REVEAL || phase === GamePhase.ROUND_RESULT) {
      html += this.getQuestionArenaHTML(lot);
    } else {
      html += this.getBiddingArenaHTML(lot);
    }

    // 4. Командалар станциялары
    html += this.getTeamsGridHTML();

    stageContainer.innerHTML = html;
    this.bindStageEvents();
  }

  // Бәссауда блогы (Табло + Балға)
  getBiddingArenaHTML(lot) {
    const currentBid = this.engine.state.currentBid;
    const leadingTeam = this.engine.getLeadingTeam();
    const gavelStep = this.engine.state.gavelStep;
    const activeStep = this.currentGlobalStep || 100;
    const currentNum = this.engine.state.currentLotIndex + 1;
    const isMystery = !!lot.isMysteryBox;

    return `
      <div class="bidding-arena ${isMystery ? 'mystery-arena-mode' : ''}">
        <div class="current-bid-display">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <div class="brass-plaque" style="padding:4px 14px; font-size:0.95rem;">
                СҰРАҚ № ${currentNum}
              </div>
              ${
                isMystery
                  ? `<div class="mystery-badge-animated">
                      <span class="mystery-badge-icon">🎁</span>
                      <span>ҚҰПИЯ ЖӘШІК (СЫРЛЫ ЛОТ)</span>
                    </div>`
                  : ''
              }
            </div>
            <div style="display:flex; gap:8px;">
              <button id="btn-prev-lot" class="btn btn-wood btn-sm" ${this.engine.state.currentLotIndex === 0 ? 'disabled' : ''} title="Алдыңғы сұраққа оралу">
                <span>◀</span> Алдыңғы
              </button>
              <button id="btn-pass-lot" class="btn btn-outline btn-sm" style="color:#FFFFFF; border-color:rgba(255,255,255,0.3);" title="Сұрақты өткізіп жіберу">
                Өткізу
              </button>
              <button id="btn-next-lot" class="btn btn-gold btn-sm" title="Келесі сұраққа өту">
                Келесі сұрақ <span>▶</span>
              </button>
            </div>
          </div>

          ${
            isMystery
              ? `
              <div class="mystery-intro-box">
                <div class="mystery-box-symbol">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#FDE047" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="8" width="18" height="13" rx="2"></rect>
                    <path d="M12 8V3"></path>
                    <path d="M12 3c-1.5 0-3 1.5-3 2.5S10 8 12 8"></path>
                    <path d="M12 3c1.5 0 3 1.5 3 2.5S14 8 12 8"></path>
                    <line x1="12" y1="8" x2="12" y2="21"></line>
                    <line x1="3" y1="13" x2="21" y2="13"></line>
                  </svg>
                </div>
                <div class="mystery-box-info">
                  <div class="mystery-title">Сұрақ мазмұны құпия!</div>
                  <div class="mystery-desc">Балға соғылғаннан кейін құпия сұрақ пен <strong>+${lot.mysteryBonus || 300} ДЖЕКПОТ БОНУСЫ</strong> ашылады!</div>
                </div>
              </div>
              `
              : `
              <div class="bidding-question-box">
                <div class="bidding-question-tag">СҰРАҚ:</div>
                <div class="bidding-question-content">«${lot.questionText}»</div>
              </div>
              `
          }

          <div class="bid-caption">${isMystery ? 'Құпия жәшікке ұсынылған ставка' : 'Ағымдағы үздік ұсыныс'}</div>
          <div class="bid-amount-glow ${isMystery ? 'mystery-bid-glow' : ''}">
            <span>${currentBid.toLocaleString()}</span>
            <span class="currency">ұпай</span>
          </div>
          ${
            leadingTeam
              ? `
              <div class="leading-team-card" style="border-left: 5px solid ${leadingTeam.color};">
                <div class="leading-badge-circle">★</div>
                <div class="leading-team-name">${leadingTeam.name}</div>
                <span class="badge badge-gold">Көшбасшы ставка</span>
              </div>
            `
              : `
              <div class="leading-team-card" style="opacity: 0.65;">
                <div class="leading-badge-circle">—</div>
                <div class="leading-team-name">Ставка қабылдануда...</div>
              </div>
            `
          }

          <div class="global-step-picker">
            <span class="global-step-label">Қадам:</span>
            <button class="btn-global-step ${activeStep === 50 ? 'active' : ''}" data-set-step="50">+50</button>
            <button class="btn-global-step ${activeStep === 100 ? 'active' : ''}" data-set-step="100">+100</button>
            <button class="btn-global-step ${activeStep === 200 ? 'active' : ''}" data-set-step="200">+200</button>
            <button class="btn-global-step ${activeStep === 500 ? 'active' : ''}" data-set-step="500">+500</button>
          </div>
        </div>

        <div class="gavel-control-zone">
          <div class="gavel-graphic-container" id="gavel-trigger" title="Балғаны соғу үшін басыңыз">
            <svg class="gavel-svg ${gavelStep > 0 ? 'gavel-striking' : ''}" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="gavelWoodApp" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#733B1E"/>
                  <stop offset="50%" stop-color="#4E2310"/>
                  <stop offset="100%" stop-color="#280F05"/>
                </linearGradient>
                <linearGradient id="gavelBrassApp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#FFF2CE"/>
                  <stop offset="40%" stop-color="#D8B24C"/>
                  <stop offset="80%" stop-color="#8A6715"/>
                  <stop offset="100%" stop-color="#FFF5D6"/>
                </linearGradient>
                <filter id="gavelDropApp" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="2" dy="5" stdDeviation="4" flood-color="#000000" flood-opacity="0.7"/>
                </filter>
              </defs>
              <g filter="url(#gavelDropApp)">
                <path d="M56 46 L78 98 C79 101 77 104 74 105 L70 106 C67 107 64 105 63 102 L45 50 Z" fill="url(#gavelWoodApp)" stroke="#1A0905" stroke-width="1.2"/>
                <rect x="67" y="94" width="12" height="6" rx="2" transform="rotate(67 67 94)" fill="url(#gavelBrassApp)"/>
                <circle cx="75" cy="103" r="4.5" fill="url(#gavelBrassApp)"/>
                <rect x="20" y="24" width="58" height="28" rx="4" transform="rotate(-23 20 24)" fill="url(#gavelWoodApp)" stroke="#200B04" stroke-width="1.5"/>
                <rect x="42" y="15" width="12" height="29" rx="1.5" transform="rotate(-23 42 15)" fill="url(#gavelBrassApp)" stroke="#5F4509" stroke-width="0.8"/>
                <rect x="18" y="25" width="6" height="28" rx="2" transform="rotate(-23 18 25)" fill="url(#gavelBrassApp)"/>
                <rect x="72" y="2" width="6" height="28" rx="2" transform="rotate(-23 72 2)" fill="url(#gavelBrassApp)"/>
              </g>
            </svg>
            <div class="impact-wave ${gavelStep > 0 ? 'active' : ''}"></div>
          </div>
          <div class="gavel-impact-block"></div>

          <div class="countdown-steps">
            <div class="countdown-step ${gavelStep >= 1 ? 'active' : ''}">I. Бір...</div>
            <div class="countdown-step ${gavelStep >= 2 ? 'active' : ''}">II. Екі...</div>
            <div class="countdown-step ${gavelStep >= 3 ? 'sold' : ''}">III. Сатылды!</div>
          </div>

          <div style="display:flex; gap:8px; width:100%;">
            <button id="btn-strike-gavel" class="btn btn-gold btn-sm" style="flex:1;">
              Балға соғу
            </button>
            <button id="btn-instant-sell" class="btn btn-burgundy btn-sm" style="flex:1;">
              Сатылды!
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Сұрақ пен Жауап аренасы
  getQuestionArenaHTML(lot) {
    const leadingTeam = this.engine.getLeadingTeam();
    const timerRemaining = this.engine.state.timerRemaining;
    const isPaused = this.engine.state.isPaused;
    const isRunning = this.engine.state.isTimerRunning;
    const isUrgent = timerRemaining <= 5 && timerRemaining > 0;
    const isMystery = !!lot.isMysteryBox;
    const mysteryBonus = isMystery ? (Number(lot.mysteryBonus) || 300) : 0;
    const totalPrize = this.engine.state.currentBid + mysteryBonus;

    return `
      <div class="question-modal-arena ${isMystery ? 'mystery-revealed-arena' : ''}">
        <div class="question-status-header">
          <div class="winning-team-announcement">
            <span class="badge" style="background:${isMystery ? 'linear-gradient(135deg, #78350F, #B45309)' : '#2563EB'}; color:#FFFFFF; font-size:0.9rem; font-weight:800; padding:4px 12px; border-radius:4px; letter-spacing:0.04em;">
              ${isMystery ? '🎁 ҚҰПИЯ ЖӘШІК АШЫЛДЫ!' : 'СҰРАҚҚА ЖАУАП БЕРУ'}
            </span>
            <strong style="font-size:1.45rem; font-weight:900; color:${leadingTeam ? leadingTeam.color : 'inherit'};">
              ${leadingTeam ? leadingTeam.name : 'Команда'}
            </strong>
            <span class="badge" style="background:#FEF3C7; color:#92400E; font-size:1rem; font-weight:900; border:1.5px solid #F59E0B; padding:3px 10px; border-radius:4px;">
              ${this.engine.state.currentBid.toLocaleString()} ₸ ұсынылды
            </span>
            ${
              isMystery
                ? `<span class="badge" style="background:#ECFDF5; color:#065F46; font-size:0.95rem; font-weight:900; border:1.5px solid #10B981; padding:3px 10px; border-radius:4px;">
                    +${mysteryBonus} Бонус джекпот!
                  </span>`
                : ''
            }
          </div>

          <div class="timer-circular-display">
            <span style="font-size:0.85rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#CBD5E1;">Уақыт:</span>
            <span class="timer-seconds-big ${isUrgent ? 'urgent' : ''}">${timerRemaining}s</span>
            <div style="display:flex; gap:4px;">
              ${
                !isRunning
                  ? `<button id="btn-timer-start" class="btn btn-gold btn-sm" style="font-weight:800; padding:4px 10px;">Бастау</button>`
                  : isPaused
                  ? `<button id="btn-timer-resume" class="btn btn-gold btn-sm" style="font-weight:800; padding:4px 10px;">Жалғастыру</button>`
                  : `<button id="btn-timer-pause" class="btn btn-wood btn-sm" style="font-weight:800; padding:4px 10px;">Үзіліс</button>`
              }
              <button id="btn-timer-reset" class="btn btn-outline btn-sm" style="font-weight:800; padding:4px 10px; background:#334155; color:#FFFFFF; border-color:#475569;">Қайтару</button>
            </div>
          </div>
        </div>

        <div class="question-text-prominent ${isMystery ? 'mystery-question-prominent' : ''}">
          «${lot.questionText}»
        </div>

        <!-- Мұғалім үшін дұрыс жауапты алдын-ала тексеру -->
        <div style="display:flex; align-items:center; gap:10px;">
          <button id="btn-peek-answer" class="btn" style="background:#F1F5F9; color:#0F172A; border:1.5px solid #CBD5E1; font-weight:700; border-radius:5px; padding:6px 14px;">Дұрыс жауапты көру (Мұғалімге)</button>
          <div id="answer-peek-box" class="teacher-answer-peek" style="display:none; flex:1;">
            <strong>Дұрыс жауап:</strong>
            <span>${lot.answerText}</span>
          </div>
        </div>

        <!-- Төрелік шешім қабылдау (Дұрыс / Қате) -->
        <div class="judgment-actions-bar">
          <button id="btn-judge-correct" class="btn btn-success btn-judge">
            ДҰРЫС ЖАУАП (+${totalPrize.toLocaleString()} ұпай)
          </button>
          <button id="btn-judge-wrong" class="btn btn-danger btn-judge">
            ҚАТЕ ЖАУАП (-${this.engine.state.currentBid.toLocaleString()} ұпай)
          </button>
          <button id="btn-finish-round" class="btn" style="background:#0F172A; color:#FDE047; border:2px solid #F59E0B; font-weight:900; font-size:1rem; border-radius:6px; padding:10px 18px;">
            Келесі сұраққа өту ▶
          </button>
        </div>
      </div>
    `;
  }

  // Командалар тақтасы
  getTeamsGridHTML() {
    const teams = this.data.teams;
    const leadingTeamId = this.engine.state.leadingTeamId;
    const currentBid = this.engine.state.currentBid;
    const activeStep = this.currentGlobalStep || Number(this.data.settings.minBidStep) || 100;
    const romanRanks = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

    // Капитал бойынша сұрыпталған орындар
    const sorted = [...teams].sort((a, b) => b.score - a.score);

    return `
      <div class="teams-section-title">
        <h3 class="serif-font" style="font-size:1.2rem;">Сауда станциялары (${teams.length} топ)</h3>
      </div>

      <div class="teams-grid">
        ${teams
          .map((team) => {
            const isLeading = team.id === leadingTeamId;
            const rankIndex = sorted.findIndex((t) => t.id === team.id);
            const rankStr = romanRanks[rankIndex] || (rankIndex + 1);
            const canAfford50 = this.data.settings.allowBankruptcy || team.score >= currentBid + 50;
            const canAfford100 = this.data.settings.allowBankruptcy || team.score >= currentBid + 100;
            const canAfford200 = this.data.settings.allowBankruptcy || team.score >= currentBid + 200;
            const canAfford500 = this.data.settings.allowBankruptcy || team.score >= currentBid + 500;

            return `
            <div class="team-card ${isLeading ? 'is-leading' : ''}" style="border-top: 5px solid ${team.color};">
              <div class="team-card-header" style="background: ${team.color};">
                <div class="team-header-left">
                  <span class="team-rank-badge">${rankStr}</span>
                  <div class="team-name-title">${team.name}</div>
                </div>
                ${isLeading ? '<span class="badge badge-gold" style="font-size:0.7rem; padding:2px 7px;">КӨШБАСШЫ</span>' : ''}
              </div>

              <div class="team-card-body">
                <div class="team-card-top-row">
                  <span class="team-score-label">Қор / Капитал:</span>
                  <div class="team-score-val" style="color:${team.color};">
                    ${team.score.toLocaleString()} <span style="font-size:0.95rem; font-weight:700; color:var(--text-muted);">₸</span>
                  </div>
                </div>

                <div class="team-step-grid">
                  <button class="btn-step-bid" data-team="${team.id}" data-delta="50" ${!canAfford50 ? 'disabled' : ''} title="«${team.name}» тобы үшін +50 ₸ бәс қосу">+50</button>
                  <button class="btn-step-bid" data-team="${team.id}" data-delta="100" ${!canAfford100 ? 'disabled' : ''} title="«${team.name}» тобы үшін +100 ₸ бәс қосу">+100</button>
                  <button class="btn-step-bid" data-team="${team.id}" data-delta="200" ${!canAfford200 ? 'disabled' : ''} title="«${team.name}» тобы үшін +200 ₸ бәс қосу">+200</button>
                  <button class="btn-step-bid" data-team="${team.id}" data-delta="500" ${!canAfford500 ? 'disabled' : ''} title="«${team.name}» тобы үшін +500 ₸ бәс қосу">+500</button>
                </div>
              </div>
            </div>
          `;
          })
          .join('')}
      </div>
    `;
  }

  openHistoryModal() {
    const modal = document.getElementById('history-modal');
    const body = document.getElementById('history-modal-body');
    if (!modal || !body) return;

    const history = this.engine.state.history || [];
    if (history.length === 0) {
      body.innerHTML = `
        <div style="text-align:center; padding:40px; color:var(--text-muted); font-style:italic;">
          Сауда шежіресінде әзірге жазбалар жоқ. Сұрақтар ойнатылған соң осында толық тізім көрсетіледі.
        </div>
      `;
    } else {
      body.innerHTML = `
        <div class="history-feed" style="max-height:none;">
          ${history
            .map(
              (h) => `
            <div class="history-item ${h.isCorrect ? 'correct' : 'wrong'}">
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <strong style="color:${h.teamColor}; font-family:var(--font-display);">${h.teamName}</strong>
                <span style="color:var(--text-muted); font-size:0.75rem;">${h.time}</span>
              </div>
              <div style="color:var(--wood-ebony); font-weight:600;">Сұрақ №${h.lotNumber}: ${h.lotTitle}</div>
              <div style="font-weight:800; color:${h.isCorrect ? '#2E8540' : '#B52626'}; margin-top:3px;">
                ${h.isCorrect ? `+${h.delta}` : `${h.delta}`} ұпай (Жауап: ${h.isCorrect ? 'Дұрыс' : 'Қате'})
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      `;
    }
    modal.classList.add('active');
  }

  renderSidebar() {
    // Тұрақты бүйірлік баған алынды — тарих пен рейтинг жеңіл әрі ыңғайлы модальда
  }

  // Финалдық марапаттау экраны (Podium)
  getPodiumHTML() {
    const leaderboard = this.engine.getLeaderboard();
    const rank1 = leaderboard[0];
    const rank2 = leaderboard[1];
    const rank3 = leaderboard[2];

    return `
      <div class="podium-arena">
        <h1 class="podium-title gold-text serif-font">АУКЦИОН АЯҚТАЛДЫ!</h1>
        <p style="font-size:1.15rem; color:var(--gold-champagne);">Жеңімпаз командаларды марапаттау салтанаты</p>

        <div class="podium-grid">
          <!-- 2-орын -->
          ${
            rank2
              ? `
            <div class="podium-col" style="order:1;">
              <div class="podium-team-badge">
                <div class="podium-team-name">${rank2.name}</div>
                <div class="podium-team-score">${rank2.score.toLocaleString()} ұпай</div>
              </div>
              <div class="podium-box rank-2">
                <div class="podium-medal">🥈</div>
                <strong style="font-size:1.3rem;">2-ОРЫН</strong>
              </div>
            </div>
          `
              : ''
          }

          <!-- 1-орын (Чемпион) -->
          ${
            rank1
              ? `
            <div class="podium-col" style="order:2;">
              <div class="podium-team-badge">
                <span class="badge badge-gold" style="font-size:0.9rem; margin-bottom:4px;">👑 БАС ЖҮЛДЕГЕР</span>
                <div class="podium-team-name" style="font-size:1.4rem;">${rank1.name}</div>
                <div class="podium-team-score" style="font-size:1.6rem; color:var(--gold-bright);">${rank1.score.toLocaleString()} ұпай</div>
              </div>
              <div class="podium-box rank-1">
                <div class="podium-medal">🏆</div>
                <strong style="font-size:1.6rem; font-family:var(--font-serif);">1-ОРЫН</strong>
              </div>
            </div>
          `
              : ''
          }

          <!-- 3-орын -->
          ${
            rank3
              ? `
            <div class="podium-col" style="order:3;">
              <div class="podium-team-badge">
                <div class="podium-team-name">${rank3.name}</div>
                <div class="podium-team-score">${rank3.score.toLocaleString()} ұпай</div>
              </div>
              <div class="podium-box rank-3">
                <div class="podium-medal">🥉</div>
                <strong style="font-size:1.2rem;">3-ОРЫН</strong>
              </div>
            </div>
          `
              : ''
          }
        </div>

        <div style="display:flex; gap:14px; margin-top:20px;">
          <button id="btn-podium-restart" class="btn btn-gold btn-lg">
            🔄 Жаңа ойынды бастау
          </button>
          <button id="btn-podium-admin" class="btn btn-wood btn-lg">
            ⚙️ Мұғалім панелі
          </button>
        </div>
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // ОҚИҒАЛАРДЫ БАЙЛАУ (EVENT LISTENERS)
  // --------------------------------------------------------------------------
  bindGlobalEvents() {
    // 1. Дыбысты қосу/өшіру
    const soundToggle = document.getElementById('btn-sound-toggle');
    if (soundToggle) {
      soundToggle.addEventListener('click', () => {
        const nextState = !this.data.settings.soundEnabled;
        this.data.settings.soundEnabled = nextState;
        sounds.setEnabled(nextState);
        StorageManager.save(this.data);
        this.renderHeader();
        this.showToast(nextState ? 'Дыбыс қосылды' : 'Дыбыс өшірілді', 'info');
      });
    }

    // 2. Проектор режимі
    const projectorToggle = document.getElementById('btn-projector-toggle');
    if (projectorToggle) {
      projectorToggle.addEventListener('click', () => {
        document.body.classList.toggle('projector-mode');
        const isProjector = document.body.classList.contains('projector-mode');
        this.showToast(isProjector ? 'Проектор / Үлкен экран режимі қосылды' : 'Қалыпты режим', 'info');
      });
    }

    // 2.1. Жарық/Қараңғы стиль (Контраст)
    const themeToggle = document.getElementById('btn-theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        localStorage.setItem('AUCTION_THEME', isDark ? 'dark' : 'light');
        this.showToast(isDark ? 'Қараңғы стиль қосылды (Жоғары контраст)' : 'Жарық стиль қосылды', 'info');
      });
    }

    // 3. Мұғалім панелін ашу
    const btnAdmin = document.getElementById('btn-open-admin');
    if (btnAdmin) {
      btnAdmin.addEventListener('click', () => this.openAdminModal());
    }

    // 4. Ойын ережелерін ашу
    const btnRules = document.getElementById('btn-open-rules');
    if (btnRules) {
      btnRules.addEventListener('click', () => this.openRulesModal());
    }

    // 5. Жаңа ойын бастау
    const btnNewGame = document.getElementById('btn-new-game');
    if (btnNewGame) {
      btnNewGame.addEventListener('click', () => {
        if (confirm('Шынымен жаңа ойын бастағыңыз келе ме? Барлық топтардың ұпайы бастапқы деңгейге түседі.')) {
          this.engine.startNewGame();
          sounds.playGavel();
          this.showToast('Жаңа ойын басталды! Сәттілік!', 'success');
        }
      });
    }

    // 6. Телефонмен қатысу QR-код модалі
    const btnOpenQR = document.getElementById('btn-open-qr-modal');
    if (btnOpenQR) {
      btnOpenQR.addEventListener('click', () => this.openPhoneQRModal());
    }

    // 7. Сауда шежіресі модалі
    const btnHistory = document.getElementById('btn-open-history');
    if (btnHistory) {
      btnHistory.addEventListener('click', () => this.openHistoryModal());
    }

    // Модальдарды жабу батырмалары
    document.querySelectorAll('.modal-close-trigger').forEach((btn) => {
      btn.addEventListener('click', () => this.closeAllModals());
    });
  }

  bindStageEvents() {
    // 1. Балға соғу
    const btnGavel = document.getElementById('btn-strike-gavel');
    const gavelGraphic = document.getElementById('gavel-trigger');
    const onGavelClick = () => {
      const res = this.engine.strikeGavelStep();
      if (!res.success) {
        this.showToast(res.message, 'warning');
      } else {
        sounds.playCountdown(res.step);
        this.showToast(`Балға соғылды: ${res.text}`, 'info');
      }
    };
    if (btnGavel) btnGavel.addEventListener('click', onGavelClick);
    if (gavelGraphic) gavelGraphic.addEventListener('click', onGavelClick);

    // 2. Лотты тікелей сату
    const btnInstantSell = document.getElementById('btn-instant-sell');
    if (btnInstantSell) {
      btnInstantSell.addEventListener('click', () => {
        const res = this.engine.instantSell();
        if (!res.success) {
          this.showToast(res.message, 'warning');
        } else {
          sounds.playCountdown(3);
          this.showToast('Сұрақ сатып алынды! Жауап беру кезеңі...', 'success');
        }
      });
    }

    // 3. Орталық бәс қадамын таңдау (+50, +100, +200, +500)
    document.querySelectorAll('[data-set-step]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = Number(btn.getAttribute('data-set-step'));
        if (val) {
          this.currentGlobalStep = val;
          this.render();
          this.showToast(`Бәс қадамы +${val} ұпай болып бекітілді`, 'info');
        }
      });
    });

    // 4. Команданың жылдам қадамдық бәс батырмалары (+50, +100, +200, +500)
    document.querySelectorAll('.btn-step-bid').forEach((btn) => {
      btn.addEventListener('click', () => {
        const teamId = btn.getAttribute('data-team');
        const delta = Number(btn.getAttribute('data-delta')) || 50;
        const res = this.engine.placeBid(teamId, null, delta);
        if (!res.success) {
          this.showToast(res.message, 'warning');
        } else {
          sounds.playBid();
        }
      });
    });

    // 4.1. Команданың басты бәс батырмасы (егер бар болса)
    document.querySelectorAll('[data-team-main]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const teamId = btn.getAttribute('data-team-main');
        const step = this.currentGlobalStep || Number(this.data.settings.minBidStep) || 100;
        const res = this.engine.placeBid(teamId, null, step);
        if (!res.success) {
          this.showToast(res.message, 'warning');
        } else {
          sounds.playBid();
        }
      });
    });

    // 5. Лотты ауыстыру / өткізу батырмалары
    const btnNext = document.getElementById('btn-next-lot');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        this.engine.moveToNextLot();
        sounds.playGavel();
      });
    }

    const btnPrev = document.getElementById('btn-prev-lot');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        this.engine.moveToPreviousLot();
      });
    }

    const btnPass = document.getElementById('btn-pass-lot');
    if (btnPass) {
      btnPass.addEventListener('click', () => {
        if (confirm('Бұл сұрақты өткізуді (сатылмады деп белгілеуді) қалайсыз ба?')) {
          this.engine.passCurrentLot();
          this.showToast('Сұрақ өткізілді.', 'info');
        }
      });
    }

    // 6. Таймерді басқару
    const btnTimerStart = document.getElementById('btn-timer-start');
    if (btnTimerStart) {
      btnTimerStart.addEventListener('click', () => {
        this.engine.startTimer(
          (rem) => {
            sounds.playTick(rem <= 5);
          },
          () => {
            sounds.playWrong();
            this.showToast('Уақыт аяқталды!', 'warning');
          }
        );
      });
    }

    const btnTimerPause = document.getElementById('btn-timer-pause');
    if (btnTimerPause) {
      btnTimerPause.addEventListener('click', () => this.engine.pauseTimer());
    }

    const btnTimerResume = document.getElementById('btn-timer-resume');
    if (btnTimerResume) {
      btnTimerResume.addEventListener('click', () => this.engine.resumeTimer());
    }

    const btnTimerReset = document.getElementById('btn-timer-reset');
    if (btnTimerReset) {
      btnTimerReset.addEventListener('click', () => this.engine.resetTimer());
    }

    // 7. Көмек және Жауапты қарау
    const btnToggleHint = document.getElementById('btn-toggle-hint');
    if (btnToggleHint) {
      btnToggleHint.addEventListener('click', () => {
        const hintBox = document.getElementById('hint-content');
        if (hintBox) {
          hintBox.style.display = hintBox.style.display === 'none' ? 'block' : 'none';
        }
      });
    }

    const btnPeekAnswer = document.getElementById('btn-peek-answer');
    if (btnPeekAnswer) {
      btnPeekAnswer.addEventListener('click', () => {
        const ansBox = document.getElementById('answer-peek-box');
        if (ansBox) {
          ansBox.style.display = ansBox.style.display === 'none' ? 'flex' : 'none';
        }
      });
    }

    // 8. Дұрыс немесе Қате жауап төрелігі
    const btnJudgeCorrect = document.getElementById('btn-judge-correct');
    if (btnJudgeCorrect) {
      btnJudgeCorrect.addEventListener('click', () => {
        const res = this.engine.resolveAnswer(true);
        if (res.success) {
          sounds.playCorrect();
          this.showToast(`ДҰРЫС! «${res.team.name}» +${res.delta.toLocaleString()} ұпай ұтып алды!`, 'success');
        }
      });
    }

    const btnJudgeWrong = document.getElementById('btn-judge-wrong');
    if (btnJudgeWrong) {
      btnJudgeWrong.addEventListener('click', () => {
        const res = this.engine.resolveAnswer(false);
        if (res.success) {
          sounds.playWrong();
          this.showToast(`ҚАТЕ! «${res.team.name}» ұпайы шегерілді!`, 'warning');
        }
      });
    }

    const btnFinishRound = document.getElementById('btn-finish-round');
    if (btnFinishRound) {
      btnFinishRound.addEventListener('click', () => {
        this.engine.moveToNextLot();
        sounds.playGavel();
      });
    }
  }

  bindPodiumEvents() {
    const btnRestart = document.getElementById('btn-podium-restart');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        this.engine.startNewGame();
        this.stopConfetti();
      });
    }

    const btnAdmin = document.getElementById('btn-podium-admin');
    if (btnAdmin) {
      btnAdmin.addEventListener('click', () => {
        this.openAdminModal();
      });
    }
  }

  // --------------------------------------------------------------------------
  // МҰҒАЛІМНІҢ БАСҚАРУ ПАНЕЛІ (ADMIN DASHBOARD)
  // --------------------------------------------------------------------------
  openAdminModal() {
    const modal = document.getElementById('admin-modal');
    if (!modal) return;

    modal.classList.add('active');
    this.switchAdminTab('questions');
  }

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.remove('active'));
  }

  openRulesModal() {
    const modal = document.getElementById('rules-modal');
    if (!modal) return;
    const body = document.getElementById('rules-modal-body');
    if (body) {
      body.innerHTML = `
        <div style="font-size:1.05rem; line-height:1.7; white-space:pre-line;">
          ${this.data.settings.rulesText || 'Ережелер енгізілмеген'}
        </div>
      `;
    }
    modal.classList.add('active');
  }

  switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });

    const contentArea = document.getElementById('admin-modal-body');
    if (!contentArea) return;

    if (tabName === 'questions') {
      contentArea.innerHTML = this.getAdminQuestionsHTML();
      this.bindAdminQuestionsEvents();
    } else if (tabName === 'teams') {
      contentArea.innerHTML = this.getAdminTeamsHTML();
      this.bindAdminTeamsEvents();
    } else if (tabName === 'settings') {
      contentArea.innerHTML = this.getAdminSettingsHTML();
      this.bindAdminSettingsEvents();
    } else if (tabName === 'backup') {
      contentArea.innerHTML = this.getAdminBackupHTML();
      this.bindAdminBackupEvents();
    }
  }

  // 1-таб: Сұрақтар қоры
  getAdminQuestionsHTML() {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <h3 class="serif-font" style="font-size:1.2rem;">Сұрақтар мен лоттар тізімі (${this.data.questions.length})</h3>
        <button id="btn-add-new-question" class="btn btn-gold btn-sm">
          ➕ Жаңа лот қосу
        </button>
      </div>

      <div id="new-question-form-container" style="display:none; margin-bottom:20px; background:#FAF8F5; padding:20px; border-radius:var(--radius-md); border:1px solid var(--gold-primary);">
        <h4 class="serif-font" style="margin-bottom:12px;">Жаңа сұрақ енгізу</h4>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Лот тақырыбы</label>
            <input type="text" id="input-q-title" class="form-input" placeholder="Мысалы: Ұлы дала тарихы" required>
          </div>
          <div class="form-group">
            <label class="form-label">Категориясы</label>
            <input type="text" id="input-q-category" class="form-input" placeholder="Тарих, Ғылым, Әдебиет..." value="Жалпы">
          </div>
          <div class="form-group">
            <label class="form-label">Бастапқы бағасы (₸)</label>
            <input type="number" id="input-q-price" class="form-input" value="100" min="50" step="50">
          </div>
          <div class="form-group">
            <label class="form-label">Күрделілігі</label>
            <select id="input-q-diff" class="form-select">
              <option value="Оңай">Оңай</option>
              <option value="Орташа" selected>Орташа</option>
              <option value="Қиын">Қиын</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Сұрақ мәтіні</label>
          <textarea id="input-q-text" class="form-textarea" rows="3" placeholder="Сұрақты толық жазыңыз..." required></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Дұрыс жауабы</label>
          <input type="text" id="input-q-answer" class="form-input" placeholder="Дұрыс жауап мәтіні..." required>
        </div>

        <div class="form-group">
          <label class="form-label">Көмек / Қосымша мәлімет (міндетті емес)</label>
          <input type="text" id="input-q-hint" class="form-input" placeholder="Ойыншыларға көмекші кілт сөздер...">
        </div>

        <div style="display:flex; gap:10px;">
          <button id="btn-save-new-question" class="btn btn-burgundy btn-sm">Сақтау</button>
          <button id="btn-cancel-new-question" class="btn btn-outline btn-sm">Бас тарту</button>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="questions-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Тақырыбы</th>
              <th>Категория</th>
              <th>Бастапқы баға</th>
              <th>Күйі</th>
              <th style="text-align:right;">Әрекеттер</th>
            </tr>
          </thead>
          <tbody>
            ${this.data.questions
              .map(
                (q, idx) => `
              <tr>
                <td><strong>${q.lotNumber || idx + 1}</strong></td>
                <td>
                  <div style="font-weight:700;">${q.title}</div>
                  <div style="font-size:0.8rem; color:var(--text-muted);">${q.questionText ? q.questionText.substring(0, 60) + '...' : ''}</div>
                </td>
                <td><span class="badge badge-wood">${q.category}</span></td>
                <td><strong>${q.startingBid} ₸</strong></td>
                <td>
                  <span class="badge ${q.status === 'sold' ? 'badge-gold' : 'badge-burgundy'}">
                    ${q.status === 'sold' ? 'Сатылды' : q.status === 'passed' ? 'Өтті' : 'Кезекте'}
                  </span>
                </td>
                <td style="text-align:right; white-space:nowrap;">
                  <button class="btn btn-outline btn-sm btn-delete-question" data-idx="${idx}" title="Өшіру">
                    🗑️ Өшіру
                  </button>
                </td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  bindAdminQuestionsEvents() {
    const btnAddNew = document.getElementById('btn-add-new-question');
    const formContainer = document.getElementById('new-question-form-container');
    const btnCancel = document.getElementById('btn-cancel-new-question');
    const btnSave = document.getElementById('btn-save-new-question');

    if (btnAddNew) {
      btnAddNew.addEventListener('click', () => {
        formContainer.style.display = 'block';
      });
    }

    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        formContainer.style.display = 'none';
      });
    }

    if (btnSave) {
      btnSave.addEventListener('click', () => {
        const title = document.getElementById('input-q-title').value.trim();
        const category = document.getElementById('input-q-category').value.trim() || 'Жалпы';
        const price = Number(document.getElementById('input-q-price').value) || 100;
        const diff = document.getElementById('input-q-diff').value;
        const text = document.getElementById('input-q-text').value.trim();
        const answer = document.getElementById('input-q-answer').value.trim();
        const hint = document.getElementById('input-q-hint').value.trim();

        if (!title || !text || !answer) {
          alert('Лоттың тақырыбын, сұрағы мен дұрыс жауабын толық жазыңыз!');
          return;
        }

        const newLot = {
          id: `lot-${Date.now()}`,
          lotNumber: this.data.questions.length + 1,
          title: title,
          category: category,
          startingBid: price,
          difficulty: diff,
          questionText: text,
          answerText: answer,
          hint: hint,
          status: 'upcoming'
        };

        this.data.questions.push(newLot);
        StorageManager.save(this.data);
        this.showToast('Жаңа сұрақ сәтті қосылды!', 'success');
        this.switchAdminTab('questions');
        this.render();
      });
    }

    // Сұрақты өшіру
    document.querySelectorAll('.btn-delete-question').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'));
        if (confirm(`Шынымен осы сұрақты өшіргіңіз келе ме?`)) {
          this.data.questions.splice(idx, 1);
          // Нөмірлерін қайта реттеу
          this.data.questions.forEach((q, i) => (q.lotNumber = i + 1));
          StorageManager.save(this.data);
          this.showToast('Сұрақ өшірілді', 'info');
          this.switchAdminTab('questions');
          this.render();
        }
      });
    });
  }

  // 2-таб: Командаларды басқару (3-10 топ)
  getAdminTeamsHTML() {
    const teams = this.data.teams;
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div>
          <h3 class="serif-font" style="font-size:1.2rem;">Командаларды реттеу (${teams.length} топ)</h3>
          <p style="font-size:0.85rem; color:var(--text-muted);">Ереже бойынша 3-тен 10-ға дейін команда қосуға болады.</p>
        </div>
        <button id="btn-add-team" class="btn btn-gold btn-sm" ${teams.length >= 10 ? 'disabled' : ''}>
          ➕ Жаңа команда қосу
        </button>
      </div>

      <div style="display:flex; flex-direction:column; gap:12px;">
        ${teams
          .map(
            (team, idx) => `
          <div style="display:grid; grid-template-columns: 40px 1fr 140px 140px 80px; gap:12px; align-items:center; background:#FAF8F5; padding:12px 16px; border-radius:var(--radius-md); border-left:6px solid ${team.color};">
            <span style="font-weight:800; color:var(--wood-walnut);">${idx + 1}</span>
            <div>
              <input type="text" class="form-input team-name-input" data-team-id="${team.id}" value="${team.name}">
            </div>
            <div>
              <select class="form-select team-color-select" data-team-id="${team.id}">
                ${AVAILABLE_COLORS.map(
                  (c) => `
                  <option value="${c.value}" ${c.value === team.color ? 'selected' : ''}>${c.name}</option>
                `
                ).join('')}
              </select>
            </div>
            <div>
              <input type="number" class="form-input team-score-input" data-team-id="${team.id}" value="${team.score}" step="100">
            </div>
            <div style="text-align:right;">
              <button class="btn btn-danger btn-sm btn-delete-team" data-team-id="${team.id}" ${teams.length <= 3 ? 'disabled title="Ең аз 3 команда болуы тиіс"' : ''}>
                🗑️
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>

      <div style="margin-top:20px; display:flex; justify-content:flex-end;">
        <button id="btn-save-teams" class="btn btn-burgundy">
          💾 Командаларды сақтау
        </button>
      </div>
    `;
  }

  bindAdminTeamsEvents() {
    // Жаңа команда қосу
    const btnAddTeam = document.getElementById('btn-add-team');
    if (btnAddTeam) {
      btnAddTeam.addEventListener('click', () => {
        if (this.data.teams.length >= 10) {
          alert('Ең көп 10 командаға ғана рұқсат беріледі!');
          return;
        }

        const newIndex = this.data.teams.length + 1;
        const color = AVAILABLE_COLORS[(newIndex - 1) % AVAILABLE_COLORS.length].value;
        const newTeam = {
          id: `team-${Date.now()}`,
          name: `«${newIndex}-ші топ»`,
          color: color,
          score: Number(this.data.settings.startingScore) || 1000,
          bidsCount: 0,
          winsCount: 0
        };

        this.data.teams.push(newTeam);
        StorageManager.save(this.data);
        this.showToast('Жаңа команда қосылды', 'success');
        this.switchAdminTab('teams');
        this.render();
      });
    }

    // Команданы өшіру
    document.querySelectorAll('.btn-delete-team').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.data.teams.length <= 3) {
          alert('Ең аз дегенде 3 команда болуы керек!');
          return;
        }
        const teamId = btn.getAttribute('data-team-id');
        this.data.teams = this.data.teams.filter((t) => t.id !== teamId);
        StorageManager.save(this.data);
        this.showToast('Команда жойылды', 'info');
        this.switchAdminTab('teams');
        this.render();
      });
    });

    // Сақтау батырмасы
    const btnSaveTeams = document.getElementById('btn-save-teams');
    if (btnSaveTeams) {
      btnSaveTeams.addEventListener('click', () => {
        document.querySelectorAll('.team-name-input').forEach((input) => {
          const teamId = input.getAttribute('data-team-id');
          const team = this.data.teams.find((t) => t.id === teamId);
          if (team) team.name = input.value.trim() || team.name;
        });

        document.querySelectorAll('.team-color-select').forEach((select) => {
          const teamId = select.getAttribute('data-team-id');
          const team = this.data.teams.find((t) => t.id === teamId);
          if (team) team.color = select.value;
        });

        document.querySelectorAll('.team-score-input').forEach((input) => {
          const teamId = input.getAttribute('data-team-id');
          const team = this.data.teams.find((t) => t.id === teamId);
          if (team) team.score = Number(input.value) || 0;
        });

        StorageManager.save(this.data);
        this.showToast('Команда деректері жаңартылды!', 'success');
        this.render();
      });
    }
  }

  // 3-таб: Ойын параметрлері
  getAdminSettingsHTML() {
    const s = this.data.settings;
    return `
      <h3 class="serif-font" style="font-size:1.2rem; margin-bottom:16px;">Ойынның негізгі ережелері мен параметрлері</h3>
      
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Бастапқы капитал (ұпай)</label>
          <input type="number" id="setting-start-score" class="form-input" value="${s.startingScore}" min="100" step="100">
        </div>
        <div class="form-group">
          <label class="form-label">Минималды ставка қадамы (ұпай)</label>
          <input type="number" id="setting-step" class="form-input" value="${s.minBidStep}" min="10" step="10">
        </div>
        <div class="form-group">
          <label class="form-label">Ойлану таймері (секунд)</label>
          <input type="number" id="setting-timer" class="form-input" value="${s.timerSeconds}" min="10" max="180" step="5">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group" style="display:flex; align-items:center; gap:10px; margin-top:10px;">
          <input type="checkbox" id="setting-penalty" style="width:20px; height:20px;" ${s.penaltyEnabled ? 'checked' : ''}>
          <label for="setting-penalty" style="font-weight:700; cursor:pointer;">Қате жауап бергенде тігілген ставканы шегеру</label>
        </div>
        <div class="form-group" style="display:flex; align-items:center; gap:10px; margin-top:10px;">
          <input type="checkbox" id="setting-bankruptcy" style="width:20px; height:20px;" ${s.allowBankruptcy ? 'checked' : ''}>
          <label for="setting-bankruptcy" style="font-weight:700; cursor:pointer;">Қарызға батуға рұқсат беру (0-ден төмен ұпай)</label>
        </div>
      </div>

      <div class="form-group" style="margin-top:16px;">
        <label class="form-label">Ойын ережесінің толық мәтіні (Сайтта көрсетілетін нұсқаулық)</label>
        <textarea id="setting-rules" class="form-textarea" rows="6">${s.rulesText}</textarea>
      </div>

      <div style="display:flex; justify-content:flex-end; margin-top:20px;">
        <button id="btn-save-settings" class="btn btn-burgundy">
          💾 Параметрлерді сақтау
        </button>
      </div>
    `;
  }

  bindAdminSettingsEvents() {
    const btnSave = document.getElementById('btn-save-settings');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        this.data.settings.startingScore = Number(document.getElementById('setting-start-score').value) || 1000;
        this.data.settings.minBidStep = Number(document.getElementById('setting-step').value) || 50;
        this.data.settings.timerSeconds = Number(document.getElementById('setting-timer').value) || 30;
        this.data.settings.penaltyEnabled = document.getElementById('setting-penalty').checked;
        this.data.settings.allowBankruptcy = document.getElementById('setting-bankruptcy').checked;
        this.data.settings.rulesText = document.getElementById('setting-rules').value;

        StorageManager.save(this.data);
        this.showToast('Баптаулар сәтті сақталды!', 'success');
        this.render();
      });
    }
  }

  // 4-таб: Резервтік көшірме & QR-код
  getAdminBackupHTML() {
    return `
      <div style="display:grid; grid-template-columns: 1fr 280px; gap:24px;">
        <div>
          <h3 class="serif-font" style="font-size:1.2rem; margin-bottom:12px;">Деректердің резервтік көшірмесі (JSON)</h3>
          <p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:16px;">
            Барлық енгізілген сұрақтар мен командаларды JSON файлына жүктеп алып, кез келген басқа компьютерге немесе браузерге оңай көшіре аласыз.
          </p>

          <div style="display:flex; flex-direction:column; gap:12px; max-width:400px;">
            <button id="btn-export-all" class="btn btn-wood">
              📥 Барлық деректерді жүктеу (Толық JSON)
            </button>
            <button id="btn-export-questions" class="btn btn-outline">
              📄 Тек сұрақтарды жүктеу (Сұрақ қоры)
            </button>

            <hr style="border:none; border-top:1px solid #EAE3D5; margin:10px 0;">

            <label class="form-label">JSON файлдан қалпына келтіру / импорттау:</label>
            <input type="file" id="input-import-file" accept=".json" class="form-input">
            <button id="btn-trigger-import" class="btn btn-gold">
              📤 Файлды жүктеу (Импорт)
            </button>
          </div>

          <div style="margin-top:30px; padding:16px; background:#FDF2E9; border-radius:var(--radius-md); border:1px solid #F5CBA7;">
            <strong style="color:#A04000;">⚠️ Барлық деректерді тазарту (Бастапқы күйге қайтару)</strong>
            <p style="font-size:0.85rem; color:#7E5109; margin:6px 0 12px;">
              Бұл әрекет барлық өзгерістерді өшіріп, жүйені алғашқы әдепкі қалыпқа келтіреді.
            </p>
            <button id="btn-factory-reset" class="btn btn-danger btn-sm">
              Барлығын өшіріп, басынан бастау
            </button>
          </div>
        </div>

        <!-- Оң жақ: QR-код -->
        <div style="background:#FAF8F5; border:1px solid var(--gold-primary); border-radius:var(--radius-md); padding:20px; display:flex; flex-direction:column; align-items:center; text-align:center;">
          <h4 class="serif-font" style="margin-bottom:10px;">Сайттың QR-коды</h4>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:14px;">Телефон немесе экран арқылы жылдам ашу сілтемесі</p>
          <canvas id="qr-code-canvas" style="border-radius:8px; box-shadow:var(--shadow-sm); margin-bottom:12px;"></canvas>
          <div style="font-size:0.75rem; word-break:break-all; color:var(--wood-walnut);" id="qr-url-text"></div>
        </div>
      </div>
    `;
  }

  bindAdminBackupEvents() {
    // Экспорт
    const btnExpAll = document.getElementById('btn-export-all');
    if (btnExpAll) {
      btnExpAll.addEventListener('click', () => {
        StorageManager.exportToJSON(this.data);
        this.showToast('Толық деректер файлы жүктелді', 'success');
      });
    }

    const btnExpQuestions = document.getElementById('btn-export-questions');
    if (btnExpQuestions) {
      btnExpQuestions.addEventListener('click', () => {
        StorageManager.exportQuestionsOnly(this.data.questions);
        this.showToast('Сұрақтар қоры жүктелді', 'success');
      });
    }

    // Импорт
    const btnTriggerImport = document.getElementById('btn-trigger-import');
    const fileInput = document.getElementById('input-import-file');
    if (btnTriggerImport && fileInput) {
      btnTriggerImport.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) {
          alert('Алдымен .json файлын таңдаңыз!');
          return;
        }

        try {
          const imported = await StorageManager.importFromJSON(file);
          if (imported.questions) this.data.questions = imported.questions;
          if (imported.teams) this.data.teams = imported.teams;
          if (imported.settings) this.data.settings = imported.settings;

          StorageManager.save(this.data);
          this.engine = new GameEngine(this.data, (d, s) => {
            this.data = d;
            if (s) StorageManager.save(this.data);
            this.render();
          });

          this.showToast('Файлдан деректер сәтті жаңартылды!', 'success');
          this.switchAdminTab('backup');
          this.render();
        } catch (err) {
          alert('Қате: ' + err.message);
        }
      });
    }

    // Factory Reset
    const btnReset = document.getElementById('btn-factory-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (confirm('Шынымен жүйені алғашқы әдепкі күйге келтіргіңіз келе ме? Барлық сұрақтар бастапқы нұсқаға оралады.')) {
          this.data = StorageManager.resetAll();
          this.engine = new GameEngine(this.data, (d, s) => {
            this.data = d;
            if (s) StorageManager.save(this.data);
            this.render();
          });
          this.showToast('Бастапқы қалпына келтірілді', 'info');
          this.switchAdminTab('backup');
          this.render();
        }
      });
    }

    // QR-код генерациялау
    const qrCanvas = document.getElementById('qr-code-canvas');
    const qrUrlText = document.getElementById('qr-url-text');
    if (qrCanvas && window.renderQRCode) {
      const currentUrl = window.location.href || 'https://auction-game.kz';
      if (qrUrlText) qrUrlText.textContent = currentUrl;
      window.renderQRCode(qrCanvas, currentUrl, { size: 190 });
    }
  }

  // --------------------------------------------------------------------------
  // КОНФЕТТИ ЭФФЕКТІСІ (VICTORY CONFETTI)
  // --------------------------------------------------------------------------
  triggerConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');

    const colors = ['#D4AF37', '#8B0000', '#1B4D3E', '#F7D058', '#E5C158', '#FFFFFF', '#4A154B'];
    this.confettiParticles = [];
    for (let i = 0; i < 160; i++) {
      this.confettiParticles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 12 + 6,
        h: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: Math.random() * 4 - 2,
        vy: Math.random() * 5 + 3,
        rot: Math.random() * 360,
        vrot: Math.random() * 8 - 4
      });
    }

    this.confettiRunning = true;
    const renderFrame = () => {
      if (!this.confettiRunning) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.confettiParticles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;

        if (p.y > canvas.height) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });

      requestAnimationFrame(renderFrame);
    };

    requestAnimationFrame(renderFrame);
  }

  stopConfetti() {
    this.confettiRunning = false;
  }

  // --------------------------------------------------------------------------
  // ТОСТ ХАБАРЛАМАЛАР
  // --------------------------------------------------------------------------
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    const icon = type === 'success' ? '✨' : type === 'warning' ? '⚠️' : '📢';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

// Қосымшаны жүктеу
document.addEventListener('DOMContentLoaded', () => {
  window.auctionApp = new AuctionApp();
  window.auctionApp.init();

  // Модаль табтарын ауыстыру тыңдаушысы
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('admin-tab-btn')) {
      const tab = e.target.getAttribute('data-tab');
      window.auctionApp.switchAdminTab(tab);
    }
  });
});
