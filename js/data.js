/* ============================================================
   data.js — 狀態、儲存、Google 試算表讀取、戰力計算
   ============================================================ */

const Store = (() => {
  const KEY = 'trainingArena.v1';

  const DEFAULTS = {
    className: '訓練競技場',
    sheetId: '',
    sheetName: '',
    autoSync: false,
    weights: { quality: 30, performance: 30, exam: 40 },
    options: { anim: true, sound: true, blind: false },
    students: [],
    history: [],          // [{ t, label, ranks:{id:rank}, totals:{id:number}, champion }]
    lastSync: null
  };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const saved = JSON.parse(raw);
      return {
        ...structuredClone(DEFAULTS),
        ...saved,
        weights: { ...DEFAULTS.weights, ...(saved.weights || {}) },
        options: { ...DEFAULTS.options, ...(saved.options || {}) }
      };
    } catch (e) {
      console.warn('[Store] 讀取本機資料失敗，改用預設值', e);
      return structuredClone(DEFAULTS);
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[Store] 無法寫入 localStorage', e);
    }
  }

  function reset() {
    localStorage.removeItem(KEY);
    state = structuredClone(DEFAULTS);
  }

  return {
    get state() { return state; },
    set(patch) { Object.assign(state, patch); save(); },
    save, reset,
    replaceAll(next) { state = next; save(); }
  };
})();


/* ── 戰力計算 ─────────────────────────────────────────── */

const Scoring = (() => {

  const TIERS = [
    { min: 95, name: '王者' },
    { min: 88, name: '鑽石' },
    { min: 80, name: '白金' },
    { min: 70, name: '黃金' },
    { min: 60, name: '白銀' },
    { min: -1, name: '青銅' }
  ];

  function tierOf(total) {
    return TIERS.find(t => total >= t.min).name;
  }

  /** 正規化權重成小數，總和為 1。三項都是 0 時退回等權。 */
  function normalizedWeights(w) {
    const sum = w.quality + w.performance + w.exam;
    if (sum <= 0) return { quality: 1 / 3, performance: 1 / 3, exam: 1 / 3 };
    return { quality: w.quality / sum, performance: w.performance / sum, exam: w.exam / sum };
  }

  function totalOf(student, w) {
    const n = normalizedWeights(w);
    return student.quality * n.quality
         + student.performance * n.performance
         + student.exam * n.exam;
  }

  /**
   * 產生排序後的榜單，附上名次、段位、與上一回合相比的名次變化。
   * @returns {Array} rows — 每筆含 rank / total / tier / delta / badges
   */
  function buildBoard(students, weights, history) {
    const rows = students.map(s => ({
      ...s,
      total: Math.round(totalOf(s, weights) * 10) / 10
    }));

    rows.sort((a, b) =>
      b.total - a.total ||
      b.exam - a.exam ||
      b.quality - a.quality ||
      a.name.localeCompare(b.name, 'zh-Hant')
    );

    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.tier = tierOf(r.total);
    });

    const prev = history.length ? history[history.length - 1] : null;
    rows.forEach(r => {
      const before = prev && prev.ranks[r.id];
      r.prevRank = before ?? null;
      r.delta = before ? before - r.rank : null;   // 正數 = 名次上升
    });

    attachBadges(rows, history);
    return rows;
  }

  /** 依全班相對表現與歷史紀錄掛上徽章 */
  function attachBadges(rows, history) {
    if (!rows.length) return;

    const best = k => Math.max(...rows.map(r => r[k]));
    const topQ = best('quality'), topP = best('performance'), topE = best('exam');

    // 進步之星：與上一回合相比名次進步最多的人（至少進步 1 名）
    let starGain = 0;
    rows.forEach(r => { if (r.delta && r.delta > starGain) starGain = r.delta; });

    // 連霸：這一回合第 1 名，且上一回合也是第 1 名
    const prev = history.length ? history[history.length - 1] : null;

    rows.forEach(r => {
      const b = [];
      if (r.rank === 1 && prev && prev.champion === r.id) b.push({ icon: '🔥', name: '連霸', desc: '連續兩回合排名第一' });
      if (r.quality === topQ && topQ > 0)     b.push({ icon: '✨', name: '品質達人', desc: '全班品質成績最高' });
      if (r.performance === topP && topP > 0) b.push({ icon: '🙋', name: '課堂之星', desc: '全班上課表現最高' });
      if (r.exam === topE && topE > 0)        b.push({ icon: '🎯', name: '考神',     desc: '全班考試成績最高' });
      if (starGain > 0 && r.delta === starGain) b.push({ icon: '🚀', name: '進步之星', desc: `名次進步 ${starGain} 名，全班最多` });
      if ([r.quality, r.performance, r.exam].some(v => v >= 100)) b.push({ icon: '💯', name: '滿分王', desc: '單項拿到滿分' });
      if (Math.max(r.quality, r.performance, r.exam) - Math.min(r.quality, r.performance, r.exam) <= 5)
        b.push({ icon: '⚖️', name: '三維均衡', desc: '三項成績差距在 5 分以內' });
      if (r.total >= 90) b.push({ icon: '⚡', name: '火力全開', desc: '總戰力 90 以上' });
      r.badges = b;
    });
  }

  /** 隊伍積分 = 組內平均戰力 */
  function buildTeams(rows) {
    const map = new Map();
    rows.forEach(r => {
      const key = (r.team || '').trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });

    const teams = [...map.entries()].map(([name, members]) => ({
      name,
      members: members.sort((a, b) => a.rank - b.rank),
      score: Math.round(members.reduce((s, m) => s + m.total, 0) / members.length * 10) / 10
    }));

    teams.sort((a, b) => b.score - a.score);
    teams.forEach((t, i) => t.rank = i + 1);
    return teams;
  }

  return { buildBoard, buildTeams, tierOf, normalizedWeights, totalOf, TIERS };
})();


/* ── Google 試算表讀取 ────────────────────────────────── */

const Sheet = (() => {

  /** 從貼上的網址抽出試算表 ID；已經是純 ID 就原樣回傳。 */
  function parseId(input) {
    const s = (input || '').trim();
    if (!s) return '';
    const m = s.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9-_]{20,})/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
    return '';
  }

  function endpoints(id, sheetName) {
    const tab = sheetName ? `&sheet=${encodeURIComponent(sheetName)}` : '';
    const urls = [
      `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${tab}`
    ];
    // 「發布到網路」產生的 2PACX- 型 ID 走另一個端點
    if (id.startsWith('2PACX-')) {
      urls.unshift(`https://docs.google.com/spreadsheets/d/e/${id}/pub?output=csv&single=true`);
    }
    return urls;
  }

  /** 逐字元解析 CSV，正確處理引號內的逗號與換行 */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (c !== '\r') {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }

  const ALIASES = {
    name:        ['姓名', '學員', '學員姓名', '名字', 'name', 'student'],
    team:        ['組別', '隊伍', '小組', '組', 'team', 'group'],
    avatar:      ['頭像', '圖示', 'avatar', 'emoji', 'icon'],
    quality:     ['品質', 'quality'],
    performance: ['表現', '上課', 'performance', 'class'],
    exam:        ['考試', '測驗', 'exam', 'test', 'score']
  };

  /** 依別名比對表頭，回傳 {欄位: 索引} */
  function mapHeaders(header) {
    const norm = header.map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
    const idx = {};
    for (const [key, words] of Object.entries(ALIASES)) {
      idx[key] = norm.findIndex(h => h && words.some(w => h.includes(w.toLowerCase())));
    }
    return idx;
  }

  function clamp100(v) {
    const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
    if (!isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  const FALLBACK_AVATARS = ['🦊','🐯','🐼','🦁','🐺','🦉','🐧','🦄','🐲','🦅','🐬','🦈','🐝','🦖','🐙','🦋','🐳'];

  function rowsToStudents(rows) {
    if (rows.length < 2) throw new Error('試算表至少要有表頭與一列資料');

    const idx = mapHeaders(rows[0]);
    if (idx.name < 0) throw new Error('找不到「姓名」欄位，請確認第一列有欄位名稱');
    if (idx.quality < 0 && idx.performance < 0 && idx.exam < 0)
      throw new Error('找不到任何成績欄位（品質成績 / 上課表現 / 考試成績）');

    const pick = (r, i) => (i >= 0 ? (r[i] ?? '').trim() : '');

    // ID 只由姓名決定，不綁列號 —— 在試算表中插入/搬動列時，歷史回合紀錄才不會全部對不上。
    const used = new Set();
    const idFor = name => {
      let id = `s_${slug(name)}`, n = 2;
      while (used.has(id)) id = `s_${slug(name)}_${n++}`;   // 同名時才加編號
      used.add(id);
      return id;
    };

    return rows.slice(1).map((r, n) => {
      const name = pick(r, idx.name);
      if (!name) return null;
      return {
        id: idFor(name),
        name,
        team: pick(r, idx.team),
        avatar: pick(r, idx.avatar) || FALLBACK_AVATARS[n % FALLBACK_AVATARS.length],
        quality:     clamp100(pick(r, idx.quality)),
        performance: clamp100(pick(r, idx.performance)),
        exam:        clamp100(pick(r, idx.exam))
      };
    }).filter(Boolean);
  }

  function slug(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /** 抓取並解析試算表；依序嘗試各端點，全部失敗才拋錯。 */
  async function fetchStudents(rawId, sheetName) {
    const id = parseId(rawId);
    if (!id) throw new Error('無法辨識試算表連結，請貼上完整的 Google 試算表網址');

    let lastErr;
    for (const url of endpoints(id, sheetName)) {
      try {
        const res = await fetch(url + `&_=${Date.now()}`, { redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (/^\s*</.test(text)) throw new Error('回傳的不是 CSV，請確認試算表已設為「知道連結的任何人可檢視」');
        const students = rowsToStudents(parseCSV(text));
        if (!students.length) throw new Error('試算表沒有讀到任何學員');
        return students;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('讀取失敗');
  }

  const TEMPLATE_HEADER = '姓名\t組別\t頭像\t品質成績\t上課表現\t考試成績';

  /** 17 人示範資料，讓沒接試算表時也能立刻看到效果 */
  function demoStudents() {
    const names = ['陳彥廷','林佳蓉','黃冠宇','張雅婷','李承翰','吳思妤','王柏叡','劉宜靜','蔡孟儒',
                   '鄭雅文','許家豪','謝欣怡','洪志明','曾郁涵','邱建華','周美玲','潘冠霖'];
    const teams = ['雷霆隊','疾風隊','烈焰隊','曜石隊'];
    return names.map((name, i) => ({
      id: `s_demo_${i}`,
      name,
      team: teams[i % 4],
      avatar: FALLBACK_AVATARS[i % FALLBACK_AVATARS.length],
      quality:     Math.round(58 + Math.random() * 42),
      performance: Math.round(58 + Math.random() * 42),
      exam:        Math.round(52 + Math.random() * 48)
    }));
  }

  return { fetchStudents, parseId, parseCSV, rowsToStudents, demoStudents, TEMPLATE_HEADER };
})();
