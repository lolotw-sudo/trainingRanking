/* ============================================================
   app.js — 啟動、事件綁定、資料流
   ============================================================ */

(() => {
  const $  = UI.$;
  const $$ = UI.$$;
  const S  = () => Store.state;

  let rows = [];
  let autoTimer = null;

  /* ── 重新計算並重繪 ───────────────────────────────── */

  function refresh() {
    const st = S();
    rows = Scoring.buildBoard(st.students, st.weights, st.history);

    UI.setCardData(rows);
    UI.renderBoard(rows, st.options);
    UI.renderTeams(Scoring.buildTeams(rows));
    UI.renderSnapshots();

    $('#className').textContent = st.className || '訓練競技場';
    $('#seasonLabel').textContent = st.history.length
      ? `第 ${st.history.length} 回合已存檔`
      : '賽季進行中';
    renderWeightMini();
  }

  function renderWeightMini() {
    const n = Scoring.normalizedWeights(S().weights);
    $('#weightMini').innerHTML = `
      <span><i class="dot dot-q"></i>品質 ${Math.round(n.quality * 100)}%</span>
      <span><i class="dot dot-p"></i>表現 ${Math.round(n.performance * 100)}%</span>
      <span><i class="dot dot-e"></i>考試 ${Math.round(n.exam * 100)}%</span>`;
  }

  /* ── 同步試算表 ───────────────────────────────────── */

  async function sync(silent = false) {
    const st = S();
    if (!st.sheetId) {
      if (!silent) {
        FX.toast('請先到「設定」貼上 Google 試算表連結', 'err');
        switchView('settings');
      }
      return;
    }

    setSyncStatus('同步中…', 'sync-busy');
    $('#btnSync').disabled = true;

    try {
      const students = await Sheet.fetchStudents(st.sheetId, st.sheetName);
      Store.set({ students, lastSync: Date.now() });
      refresh();
      setSyncStatus(`已同步 ${timeStr(Date.now())}`, 'sync-ok');
      setSheetStatus(`✅ 讀到 ${students.length} 位學員。`, 'ok');
      if (!silent) FX.toast(`已從試算表讀入 ${students.length} 位學員`, 'ok');
    } catch (err) {
      console.error('[sync]', err);
      setSyncStatus('同步失敗', 'sync-err');
      setSheetStatus(`❌ ${err.message}<br>檢查：試算表共用權限是否為「知道連結的任何人 → 檢視者」、分頁名稱是否正確。`, 'err');
      if (!silent) FX.toast(`同步失敗：${err.message}`, 'err');
    } finally {
      $('#btnSync').disabled = false;
    }
  }

  function setSyncStatus(text, cls) {
    const el = $('#syncStatus');
    el.textContent = text;
    el.className = cls || '';
  }

  function setSheetStatus(html, cls) {
    const el = $('#sheetStatus');
    el.innerHTML = html;
    el.className = 'callout ' + (cls || '');
  }

  const timeStr = t => new Date(t).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });

  function setAutoSync(on) {
    clearInterval(autoTimer);
    autoTimer = null;
    if (on) autoTimer = setInterval(() => sync(true), 60000);
  }

  /* ── 回合存檔 ─────────────────────────────────────── */

  function snapshot() {
    if (!rows.length) { FX.toast('沒有資料可以存檔', 'err'); return; }

    const st = S();
    const snap = {
      t: Date.now(),
      label: `第 ${st.history.length + 1} 回合 · ${new Date().toLocaleDateString('zh-TW')}`,
      ranks:  Object.fromEntries(rows.map(r => [r.id, r.rank])),
      totals: Object.fromEntries(rows.map(r => [r.id, r.total])),
      champion: rows[0].id
    };

    st.history.push(snap);
    Store.save();
    refresh();
    FX.toast(`📌 ${snap.label} 已存檔`, 'ok');
  }

  /* ── 分頁切換 ─────────────────────────────────────── */

  function switchView(name) {
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
    $$('.view').forEach(v => v.classList.toggle('is-active', v.id === `view-${name}`));
  }

  /* ── 權重滑桿 ─────────────────────────────────────── */

  function bindWeights() {
    $$('.weight-row').forEach(row => {
      const key = row.dataset.key;
      const input = row.querySelector('input');
      const out = row.querySelector('output');

      input.value = S().weights[key];
      const sync = () => {
        S().weights[key] = Number(input.value);
        Store.save();
        updateWeightOutputs();
        refresh();
      };
      input.addEventListener('input', sync);
    });
    updateWeightOutputs();
  }

  function updateWeightOutputs() {
    const n = Scoring.normalizedWeights(S().weights);
    $$('.weight-row').forEach(row => {
      const key = row.dataset.key;
      row.querySelector('input').value = S().weights[key];
      row.querySelector('output').textContent = Math.round(n[key] * 100) + '%';
    });
  }

  function applyPreset(str) {
    const [q, p, e] = str.split(',').map(Number);
    S().weights = { quality: q, performance: p, exam: e };
    Store.save();
    updateWeightOutputs();
    refresh();
  }

  /* ── 匯出 / 匯入 ──────────────────────────────────── */

  function exportBackup() {
    const blob = new Blob([JSON.stringify(S(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `training-arena-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    FX.toast('備份已下載', 'ok');
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.students)) throw new Error('檔案格式不正確');
        Store.replaceAll(data);
        hydrateSettings();
        refresh();
        FX.toast('備份已還原', 'ok');
      } catch (e) {
        FX.toast(`匯入失敗：${e.message}`, 'err');
      }
    };
    reader.readAsText(file);
  }

  /* ── 把 state 填回設定畫面 ────────────────────────── */

  function hydrateSettings() {
    const st = S();
    $('#sheetUrl').value = st.sheetId;
    $('#sheetName').value = st.sheetName;
    $('#classNameInput').value = st.className;
    $('#autoSync').checked = st.autoSync;
    $('#optAnim').checked = st.options.anim;
    $('#optSound').checked = st.options.sound;
    $('#optBlind').checked = st.options.blind;

    FX.setAnim(st.options.anim);
    FX.setSound(st.options.sound);
    updateWeightOutputs();
    setAutoSync(st.autoSync);
  }

  /* ── 事件綁定 ─────────────────────────────────────── */

  function bindEvents() {
    $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

    $('#btnSync').addEventListener('click', () => sync());
    $('#btnSnapshot').addEventListener('click', snapshot);
    $('#btnCeremony').addEventListener('click', () => Ceremony.open(rows));

    $('#btnSaveSheet').addEventListener('click', () => {
      const id = Sheet.parseId($('#sheetUrl').value);
      if (!id) { setSheetStatus('❌ 這不像是 Google 試算表連結，請貼上瀏覽器網址列的完整連結。', 'err'); return; }
      Store.set({ sheetId: id, sheetName: $('#sheetName').value.trim() });
      $('#sheetUrl').value = id;
      sync();
    });

    $('#autoSync').addEventListener('change', e => {
      Store.set({ autoSync: e.target.checked });
      setAutoSync(e.target.checked);
      FX.toast(e.target.checked ? '已開啟自動同步（每 60 秒）' : '已關閉自動同步');
    });

    $('#btnCopyTemplate').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(Sheet.TEMPLATE_HEADER);
        FX.toast('表頭已複製，貼到試算表第一列即可', 'ok');
      } catch {
        setSheetStatus(`手動複製這一列到試算表第一列：<br><code>${Sheet.TEMPLATE_HEADER.replace(/\t/g, ' | ')}</code>`);
      }
    });

    $('#btnLoadDemo').addEventListener('click', () => {
      Store.set({ students: Sheet.demoStudents() });
      refresh();
      switchView('solo');
      FX.toast('已載入 17 人示範資料', 'ok');
    });

    $('#classNameInput').addEventListener('input', e => {
      Store.set({ className: e.target.value });
      $('#className').textContent = e.target.value || '訓練競技場';
    });

    $('#optAnim').addEventListener('change', e => {
      S().options.anim = e.target.checked; Store.save(); FX.setAnim(e.target.checked);
    });
    $('#optSound').addEventListener('change', e => {
      S().options.sound = e.target.checked; Store.save(); FX.setSound(e.target.checked);
    });
    $('#optBlind').addEventListener('change', e => {
      S().options.blind = e.target.checked; Store.save(); refresh();
    });

    $$('[data-preset]').forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));

    $('#btnExport').addEventListener('click', exportBackup);
    $('#btnImport').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); });
    $('#btnReset').addEventListener('click', () => {
      if (!confirm('確定要清除所有本機資料嗎？包含試算表設定與所有回合紀錄，這個動作無法復原。')) return;
      Store.reset();
      hydrateSettings();
      refresh();
      setSheetStatus('');
      setSyncStatus('尚未同步', '');
      FX.toast('已清除本機資料');
    });

    $('#drawerClose').addEventListener('click', UI.closeCard);
    $('#drawerScrim').addEventListener('click', UI.closeCard);

    $('#cNext').addEventListener('click', () => Ceremony.next());
    $('#cPrev').addEventListener('click', () => Ceremony.prev());
    $('#cAuto').addEventListener('click', () => Ceremony.toggleAuto());
    $('#cExit').addEventListener('click', () => Ceremony.close());

    document.addEventListener('keydown', e => {
      if (Ceremony.handleKey(e)) return;
      if (e.target.matches('input, textarea')) return;

      switch (e.key.toLowerCase()) {
        case 'escape': UI.closeCard(); break;
        case 'r': sync(); break;
        case 's': snapshot(); break;
        case 'c': Ceremony.open(rows); break;
        case '1': switchView('solo'); break;
        case '2': switchView('team'); break;
        case '3': switchView('settings'); break;
      }
    });
  }

  /* ── 啟動 ─────────────────────────────────────────── */

  function init() {
    FX.startBackground(document.getElementById('bgCanvas'));
    FX.initConfetti(document.getElementById('fxCanvas'));

    hydrateSettings();
    bindWeights();
    bindEvents();
    refresh();

    const st = S();
    if (st.lastSync) setSyncStatus(`上次同步 ${timeStr(st.lastSync)}`, '');

    if (st.sheetId) {
      sync(true);
    } else if (!st.students.length) {
      // 第一次打開就有東西可看，不會是一片空白
      Store.set({ students: Sheet.demoStudents() });
      refresh();
      setSheetStatus('目前顯示的是示範資料。貼上你的 Google 試算表連結後按「儲存並同步」就會換成真實班級。');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
