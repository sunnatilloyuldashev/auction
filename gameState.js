// Ойын күйі және бәссауда логикасының негізгі менеджері
export const GamePhase = {
  LOT_INTRO: 'LOT_INTRO',             // Лотты таныстыру
  BIDDING: 'BIDDING',                 // Бәссауда / Ставкалар қабылдау
  GAVEL_COUNTDOWN: 'GAVEL_COUNTDOWN', // «Бір... Екі... Сатылды!» соққылары
  QUESTION_REVEAL: 'QUESTION_REVEAL', // Сұрақ ашылды, ойлану уақыты
  ROUND_RESULT: 'ROUND_RESULT',       // Нәтижені бекіту
  GAME_OVER: 'GAME_OVER'              // Ойын аяқталды, жеңімпаздар
};

export class GameEngine {
  constructor(data, onStateChange) {
    this.settings = data.settings;
    this.teams = data.teams;
    this.questions = data.questions;
    this.onStateChange = onStateChange || (() => {});

    if (!data.gameState) {
      this.shuffleQuestions();
    }

    // Ойынның ағымдағы динамикалық күйі
    this.state = data.gameState || this.getInitialState();

    this.timerInterval = null;
  }

  // Сұрақтарды кездейсоқ (рандом) араластыру (Fisher-Yates)
  shuffleQuestions() {
    if (!this.questions || this.questions.length <= 1) return;
    for (let i = this.questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.questions[i], this.questions[j]] = [this.questions[j], this.questions[i]];
    }
    this.questions.forEach((q, idx) => {
      q.lotNumber = idx + 1;
    });
  }

  getInitialState() {
    return {
      currentLotIndex: 0,
      phase: GamePhase.LOT_INTRO,
      currentBid: this.questions[0] ? this.questions[0].startingBid : 100,
      leadingTeamId: null,
      gavelStep: 0, // 0: дайын, 1: «Бір!», 2: «Екі!», 3: «Сатылды!»
      timerRemaining: this.settings.timerSeconds || 30,
      isTimerRunning: false,
      isPaused: false,
      lastAction: null,
      history: []
    };
  }

  // Ағымдағы лотты алу
  getCurrentLot() {
    if (!this.questions || this.questions.length === 0) return null;
    return this.questions[this.state.currentLotIndex] || null;
  }

  // Көшбасшы команданы алу
  getLeadingTeam() {
    if (!this.state.leadingTeamId) return null;
    return this.teams.find(t => t.id === this.state.leadingTeamId) || null;
  }

  // Жаңа ойынды бастау (ұпайларды бастапқы мәнге келтіру)
  startNewGame() {
    this.stopTimer();
    this.teams.forEach(t => {
      t.score = Number(this.settings.startingScore) || 1000;
      t.bidsCount = 0;
      t.winsCount = 0;
    });

    this.shuffleQuestions();

    this.questions.forEach(q => {
      q.status = 'upcoming';
    });

    this.state = {
      currentLotIndex: 0,
      phase: GamePhase.LOT_INTRO,
      currentBid: this.questions[0] ? this.questions[0].startingBid : 100,
      leadingTeamId: null,
      gavelStep: 0,
      timerRemaining: this.settings.timerSeconds || 30,
      isTimerRunning: false,
      isPaused: false,
      lastAction: 'Жаңа ойын басталды (Сұрақтар кездейсоқ таңдалды)',
      history: []
    };

    this.emitChange();
  }

  // Бәссауданы бастау
  beginBidding() {
    const lot = this.getCurrentLot();
    if (!lot) return;

    this.state.phase = GamePhase.BIDDING;
    this.state.currentBid = lot.startingBid;
    this.state.leadingTeamId = null;
    this.state.gavelStep = 0;
    this.state.lastAction = `«${lot.title}» бойынша бәссауда басталды! Бастапқы бағасы: ${lot.startingBid} ₸`;
    this.emitChange();
  }

  // Ставка қою
  placeBid(teamId, customAmount = null, deltaStep = null) {
    const team = this.teams.find(t => t.id === teamId);
    if (!team) return { success: false, message: 'Команда табылмады!' };

    let newBid = 0;
    const minStep = Number(this.settings.minBidStep) || 50;

    if (customAmount !== null) {
      newBid = Number(customAmount);
    } else if (deltaStep !== null) {
      newBid = this.state.currentBid + Number(deltaStep);
    } else {
      // Әдепкі қадам
      newBid = this.state.currentBid + minStep;
    }

    // Тексеру 1: Бастапқы немесе ағымдағы ставкадан жоғары ма?
    if (this.state.leadingTeamId === null) {
      // Алғашқы ставка бастапқы бағадан кем болмауы керек
      const lot = this.getCurrentLot();
      const minStart = lot ? lot.startingBid : 100;
      if (newBid < minStart) {
        return { success: false, message: `Ставка бастапқы бағадан (${minStart}) кем болмауы керек!` };
      }
    } else {
      if (newBid <= this.state.currentBid) {
        return { success: false, message: `Ставка ағымдағы бағадан (${this.state.currentBid}) кемінде ${minStep} ұпайға артық болуы тиіс!` };
      }
    }

    // Тексеру 2: Топтың капиталы жете ме?
    if (!this.settings.allowBankruptcy && team.score < newBid) {
      return { success: false, message: `«${team.name}» тобының капиталы жеткіліксіз! Қолда бар: ${team.score} ұпай` };
    }

    // Ставка қабылданды
    this.state.currentBid = newBid;
    this.state.leadingTeamId = team.id;
    this.state.gavelStep = 0; // Жаңа ставка болғанда балға санағы қайта басталады
    team.bidsCount = (team.bidsCount || 0) + 1;
    this.state.lastAction = `«${team.name}» ставка ұсынды: ${newBid} ұпай`;

    this.emitChange();
    return { success: true, bid: newBid, team };
  }

  // Балға соғу қадамы (1 -> 2 -> 3 "Сатылды!")
  strikeGavelStep() {
    if (this.state.leadingTeamId === null) {
      return { success: false, message: 'Әзірге ешқандай топ ставка ұсынған жоқ!' };
    }

    this.state.phase = GamePhase.GAVEL_COUNTDOWN;
    this.state.gavelStep += 1;

    let stepText = '';
    if (this.state.gavelStep === 1) {
      stepText = '«Бір...»';
    } else if (this.state.gavelStep === 2) {
      stepText = '«Екі...»';
    } else if (this.state.gavelStep >= 3) {
      this.state.gavelStep = 3;
      stepText = '«Сатылды!»';
      // Сауда аяқталды, сұрақ ашу фазасына өту
      this.state.phase = GamePhase.QUESTION_REVEAL;
      this.state.timerRemaining = Number(this.settings.timerSeconds) || 30;
      this.state.isTimerRunning = false;
    }

    this.state.lastAction = `Балға: ${stepText}`;
    this.emitChange();
    return { success: true, step: this.state.gavelStep, text: stepText };
  }

  // Тікелей «Сатылды!» жасау (жүргізуші тездеткісі келсе)
  instantSell() {
    if (this.state.leadingTeamId === null) {
      return { success: false, message: 'Әзірге ставка қойылған жоқ!' };
    }
    this.state.gavelStep = 3;
    this.state.phase = GamePhase.QUESTION_REVEAL;
    this.state.timerRemaining = Number(this.settings.timerSeconds) || 30;
    this.state.isTimerRunning = false;
    this.state.lastAction = `Лот ең жоғарғы ставкамен сатылды!`;
    this.emitChange();
    return { success: true };
  }

  // Таймерді басқару
  startTimer(onTick, onComplete) {
    this.stopTimer();
    this.state.isTimerRunning = true;
    this.state.isPaused = false;

    this.timerInterval = setInterval(() => {
      if (this.state.isPaused) return;

      this.state.timerRemaining -= 1;
      if (typeof onTick === 'function') {
        onTick(this.state.timerRemaining);
      }

      if (this.state.timerRemaining <= 0) {
        this.stopTimer();
        this.state.timerRemaining = 0;
        this.state.isTimerRunning = false;
        if (typeof onComplete === 'function') {
          onComplete();
        }
      }
      this.emitChange(false); // UI жаңарту (жиі сақтамау үшін false)
    }, 1000);

    this.emitChange();
  }

  pauseTimer() {
    this.state.isPaused = true;
    this.emitChange();
  }

  resumeTimer() {
    this.state.isPaused = false;
    this.emitChange();
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.state.isTimerRunning = false;
  }

  resetTimer() {
    this.stopTimer();
    this.state.timerRemaining = Number(this.settings.timerSeconds) || 30;
    this.state.isPaused = false;
    this.emitChange();
  }

  // Жауапты тексеру: Дұрыс немесе Қате
  resolveAnswer(isCorrect) {
    this.stopTimer();
    const lot = this.getCurrentLot();
    const team = this.getLeadingTeam();
    if (!lot || !team) return { success: false };

    const bid = this.state.currentBid;
    let delta = 0;
    const isMystery = !!lot.isMysteryBox;
    const mysteryBonus = isMystery ? (Number(lot.mysteryBonus) || 300) : 0;

    if (isCorrect) {
      // Ұпай қосылады (егер Құпия жәшік болса, бонус қосылады)
      delta = bid + mysteryBonus;
      team.score += delta;
      team.winsCount = (team.winsCount || 0) + 1;
      lot.status = 'sold';
      if (isMystery) {
        this.state.lastAction = `ДҰРЫС! ҚҰПИЯ ЖӘШІК ДЖЕКПОТЫ! «${team.name}» тобына +${delta} ұпай (+${mysteryBonus} бонус) қосылды!`;
      } else {
        this.state.lastAction = `ДҰРЫС! «${team.name}» тобына +${delta} ұпай қосылды!`;
      }
    } else {
      // Ұпай шегеріледі (егер баптауда қосылса)
      if (this.settings.penaltyEnabled) {
        delta = -bid;
        team.score += delta;
      }
      lot.status = 'sold';
      this.state.lastAction = `ҚАТЕ! «${team.name}» тобынан ${Math.abs(delta)} ұпай шегерілді!`;
    }

    // Тарихқа қосу
    this.state.history.unshift({
      time: new Date().toLocaleTimeString('kk-KZ', { hour: '2-digit', minute: '2-digit' }),
      lotNumber: lot.lotNumber,
      lotTitle: isMystery ? `[ҚҰПИЯ ЖӘШІК] ${lot.title}` : lot.title,
      teamName: team.name,
      teamColor: team.color,
      bid: bid,
      isCorrect: isCorrect,
      delta: delta,
      finalScore: team.score
    });

    this.state.phase = GamePhase.ROUND_RESULT;
    this.emitChange();
    return { success: true, isCorrect, delta, team, lot };
  }

  // Лотты саудасыз өткізу (ешкім алмаса немесе жүргізуші шешімімен)
  passCurrentLot() {
    this.stopTimer();
    const lot = this.getCurrentLot();
    if (lot) {
      lot.status = 'passed';
      this.state.lastAction = `«${lot.title}» сұрағы өткізілді (сатылмады).`;
    }
    this.moveToNextLot();
  }

  // Келесі сұраққа өту
  moveToNextLot() {
    this.stopTimer();

    if (this.state.currentLotIndex + 1 < this.questions.length) {
      this.state.currentLotIndex += 1;
      const nextLot = this.getCurrentLot();
      this.state.phase = GamePhase.LOT_INTRO;
      this.state.currentBid = nextLot ? nextLot.startingBid : 100;
      this.state.leadingTeamId = null;
      this.state.gavelStep = 0;
      this.state.timerRemaining = Number(this.settings.timerSeconds) || 30;
      this.state.lastAction = `Келесі сұрақ: №${this.state.currentLotIndex + 1} «${nextLot.title}» (${nextLot.startingBid} ₸)`;
    } else {
      // Барлық сұрақтар таусылды — ОЙЫН АЯҚТАЛДЫ!
      this.state.phase = GamePhase.GAME_OVER;
      this.state.lastAction = `Ойын салтанатты түрде аяқталды! Жеңімпаздарды қарсы алыңыздар!`;
    }

    this.emitChange();
  }

  // Алдыңғы лотқа оралу (қате кетсе)
  moveToPreviousLot() {
    if (this.state.currentLotIndex > 0) {
      this.stopTimer();
      this.state.currentLotIndex -= 1;
      const prevLot = this.getCurrentLot();
      this.state.phase = GamePhase.LOT_INTRO;
      this.state.currentBid = prevLot ? prevLot.startingBid : 100;
      this.state.leadingTeamId = null;
      this.state.gavelStep = 0;
      this.state.timerRemaining = Number(this.settings.timerSeconds) || 30;
      this.state.lastAction = `Алдыңғы лотқа оралды: №${prevLot.lotNumber}`;
      this.emitChange();
    }
  }

  // Белгілі бір лотқа секіру
  selectLotByIndex(index) {
    if (index >= 0 && index < this.questions.length) {
      this.stopTimer();
      this.state.currentLotIndex = index;
      const lot = this.getCurrentLot();
      this.state.phase = GamePhase.LOT_INTRO;
      this.state.currentBid = lot ? lot.startingBid : 100;
      this.state.leadingTeamId = null;
      this.state.gavelStep = 0;
      this.state.timerRemaining = Number(this.settings.timerSeconds) || 30;
      this.emitChange();
    }
  }

  // Ойынды мәжбүрлі аяқтау (финалдық экранды ашу)
  finishGameNow() {
    this.stopTimer();
    this.state.phase = GamePhase.GAME_OVER;
    this.state.lastAction = `Ойын аяқталды. Қорытынды кесте көрсетілді.`;
    this.emitChange();
  }

  // Рейтингті ұпай бойынша сұрыптап алу
  getLeaderboard() {
    return [...this.teams].sort((a, b) => b.score - a.score);
  }

  emitChange(triggerSave = true) {
    this.onStateChange(this.exportFullData(), triggerSave);
  }

  exportFullData() {
    return {
      settings: this.settings,
      teams: this.teams,
      questions: this.questions,
      gameState: this.state
    };
  }
}
