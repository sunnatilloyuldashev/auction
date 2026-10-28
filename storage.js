// Деректерді LocalStorage арқылы сақтау және JSON импорт/экспорт менеджері
import { DEFAULT_SETTINGS, DEFAULT_TEAMS, DEFAULT_QUESTIONS } from './defaultData.js';

const STORAGE_KEY = 'AUCTION_GAME_DATA_v1.0';

export class StorageManager {
  static load() {
    try {
      const serialized = localStorage.getItem(STORAGE_KEY);
      if (!serialized) {
        return this.getDefaults();
      }
      const data = JSON.parse(serialized);

      // Деректер құрылымын валидациялау
      return {
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
        teams: Array.isArray(data.teams) && data.teams.length >= 2 ? data.teams : JSON.parse(JSON.stringify(DEFAULT_TEAMS)),
        questions: Array.isArray(data.questions) && data.questions.length > 0 ? data.questions : JSON.parse(JSON.stringify(DEFAULT_QUESTIONS)),
        gameState: data.gameState || null
      };
    } catch (e) {
      console.error('LocalStorage оқу қатесі, әдепкі деректер алынды:', e);
      return this.getDefaults();
    }
  }

  static getDefaults() {
    return {
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      teams: JSON.parse(JSON.stringify(DEFAULT_TEAMS)),
      questions: JSON.parse(JSON.stringify(DEFAULT_QUESTIONS)),
      gameState: null
    };
  }

  static save(appData) {
    try {
      const payload = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        settings: appData.settings,
        teams: appData.teams,
        questions: appData.questions,
        gameState: appData.gameState
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('LocalStorage-ге сақтау сәтсіз аяқталды:', e);
      return false;
    }
  }

  static resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    return this.getDefaults();
  }

  // JSON файл ретінде экспорттау (жүктеп алу)
  static exportToJSON(data, filename = 'aucsion_oyyn_derekteri.json') {
    const exportObject = {
      title: '«АУКЦИОН» Интерактивті ойын қоры',
      exportedAt: new Date().toISOString(),
      settings: data.settings,
      teams: data.teams,
      questions: data.questions
    };

    const jsonStr = JSON.stringify(exportObject, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Тек сұрақтарды JSON ретінде экспорттау
  static exportQuestionsOnly(questions, filename = 'aucsion_suaqtar.json') {
    const exportObject = {
      title: '«АУКЦИОН» Сұрақтар қоры',
      exportedAt: new Date().toISOString(),
      questions: questions
    };

    const jsonStr = JSON.stringify(exportObject, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Файлдан JSON оқу және импорттау
  static async importFromJSON(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('Файл таңдалмады'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);

          // Валидация
          if (!parsed) {
            throw new Error('Файл бос немесе жарамсыз');
          }

          const result = {};

          if (Array.isArray(parsed.questions)) {
            result.questions = parsed.questions.map((q, idx) => ({
              id: q.id || `lot-${Date.now()}-${idx}`,
              lotNumber: q.lotNumber || idx + 1,
              title: q.title || `Лот №${idx + 1}`,
              category: q.category || 'Жалпы',
              difficulty: q.difficulty || 'Орташа',
              startingBid: Number(q.startingBid) || 100,
              questionText: q.questionText || '',
              answerText: q.answerText || '',
              hint: q.hint || '',
              status: 'upcoming'
            }));
          }

          if (Array.isArray(parsed.teams) && parsed.teams.length >= 2) {
            result.teams = parsed.teams.map((t, idx) => ({
              id: t.id || `team-${idx + 1}`,
              name: t.name || `Команда ${idx + 1}`,
              color: t.color || '#8B0000',
              score: Number(t.score) || 1000,
              bidsCount: 0,
              winsCount: 0
            }));
          }

          if (parsed.settings && typeof parsed.settings === 'object') {
            result.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
          }

          if (!result.questions && !result.teams && !result.settings) {
            throw new Error('JSON файлынан сұрақтар немесе баптаулар табылмады!');
          }

          resolve(result);
        } catch (err) {
          reject(new Error('JSON файлын оқу қатесі: ' + err.message));
        }
      };

      reader.onerror = () => reject(new Error('Файлды оқу мүмкін болмады'));
      reader.readAsText(file);
    });
  }
}
