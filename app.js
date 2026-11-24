import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
(() => {
  'use strict';
  const STORAGE_KEY = 'shiguang-student-planner-v1';
  const categoryLabels = { study: '讀書', class: '課程', life: '生活', club: '社團' };
  const priorityLabels = { high: '重要', medium: '普通', low: '彈性' };
  const planTypeLabels = { yearly: '年度計畫', monthly: '月計畫', daily: '每日行程' };
  const formatPlanDate = (value, type) => {
    if (!value) return '';
    if (type === 'yearly') return `${value}年`;
    const [year, month, day] = value.split('-');
    return day ? `${year}/${month}/${day}` : `${year}/${month}`;
  };
  const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const today = new Date();
  const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let selectedDate = dateKey(today);
  let calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function makeWelcomeSchedule() {
    const date = dateKey(new Date());
    const examples = [
      { suffix: 'study', title: '範例：晨間讀書', start: '09:00', end: '10:30', category: 'study', location: '自習室' },
      { suffix: 'class', title: '範例：課程安排', start: '13:30', end: '15:00', category: 'class', location: '教室' },
      { suffix: 'life', title: '範例：休息與散步', start: '', end: '', category: 'life', location: '附近公園' }
    ];
    return {
      events: examples.map((item) => ({ id: `sample-e-${item.suffix}`, planId: `sample-p-${item.suffix}`, date, ...item, isSample: true })),
      plans: examples.map((item) => ({ id: `sample-p-${item.suffix}`, type: 'daily', date, ...item, createdAt: Date.now() }))
    };
  }
  function ensureInitialSchedule(value) {
    if (value.welcomeScheduleInitialized) return value;
    if (!value.events.length && !value.plans.length) {
      const examples = makeWelcomeSchedule();
      value.events = examples.events;
      value.plans = examples.plans;
    }
    value.welcomeScheduleInitialized = true;
    return value;
  }
  const defaultState = () => ({
      ...makeWelcomeSchedule(),
      welcomeScheduleInitialized: true,
      tasks: [
        { id: 't1', title: '完成數學作業', subtitle: '今天到期', priority: 'high', completed: false },
        { id: 't2', title: '複習英文單字', subtitle: '今天複習', priority: 'medium', completed: true },
        { id: 't3', title: '整理課堂筆記', subtitle: '本週任務', priority: 'low', completed: false }
      ]
    });
  function loadState() {
    try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s && Array.isArray(s.events) && Array.isArray(s.tasks)) { if (!Array.isArray(s.goals)) s.goals = []; if (!Array.isArray(s.plans)) s.plans = []; return ensureInitialSchedule(s); } }
    catch (error) { console.warn('無法讀取已儲存的行程，將使用空白行程與範例待辦。', error); }
    return defaultState();
  }
  let state = loadState();
  let currentUser = null;
  let cloudReady = false;
  let firestore = null;
  const firebaseConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_') && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith('YOUR_');
  if (firebaseConfigured) {
    const app = initializeApp(firebaseConfig);
    firestore = getFirestore(app);
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    document.getElementById('auth-button').addEventListener('click', async () => {
      try {
        if (currentUser) await signOut(auth);
        else await signInWithPopup(auth, provider);
      } catch (error) { console.error(error); showToast('登入失敗，請確認 Firebase 網域與 Google 登入設定'); }
    });
    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      cloudReady = false;
      if (!user) {
        state = defaultState();
        render();
      }
      updateAccount();
      if (user) {
        try {
          const ref = doc(firestore, 'users', user.uid, 'planner', 'state');
          const snapshot = await getDoc(ref);
          if (snapshot.exists()) {
            const cloudState = snapshot.data();
            state = ensureInitialSchedule({ ...defaultState(), ...cloudState, welcomeScheduleInitialized: cloudState.welcomeScheduleInitialized === true });
          }
          else await setDoc(ref, state);
          cloudReady = true;
          render();
          showToast(snapshot.exists() ? '已從 Firestore 載入你的行程' : '已開始同步行程至 Firestore');
        } catch (error) { console.error(error); showToast('讀取 Firestore 失敗，請檢查資料庫規則'); }
      }
      updateAccount();
    });
  } else {
    document.getElementById('account-status').textContent = '請先設定 Firebase';
    document.getElementById('auth-button').disabled = true;
  }
  function updateAccount() {
    const button = document.getElementById('auth-button');
    if (!firebaseConfigured) return;
    document.getElementById('account-name').textContent = currentUser?.displayName || '尚未登入';
    document.getElementById('account-status').textContent = currentUser ? (cloudReady ? 'Firestore 已同步' : '正在同步…') : '登入以同步行程';
    document.getElementById('account-avatar').textContent = currentUser?.displayName?.slice(0, 1) || '✳';
    button.textContent = currentUser ? '登出' : 'Google 登入';
    button.disabled = false;
  }
  let toastTimer;
  const save = () => {
    if (!currentUser) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { console.warn('無法在這個瀏覽器儲存資料。', error); }
    }
    if (currentUser && cloudReady) setDoc(doc(firestore, 'users', currentUser.uid, 'planner', 'state'), state).catch((error) => { console.error(error); showToast('雲端儲存失敗，請稍後重試'); });
  };
  const showToast = (message) => { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2400); };
  const dateFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  const monthFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long' });
  function renderHeader() {
    document.getElementById('header-date').textContent = dateFormatter.format(today);
    document.getElementById('today-date').textContent = dateFormatter.format(today);
    document.getElementById('day-name').textContent = weekdayNames[today.getDay()];
    const selected = new Date(`${selectedDate}T00:00:00`);
    document.getElementById('calendar-month-label').textContent = monthFormatter.format(calendarMonth);
    document.getElementById('selected-day-label').textContent = `${dateFormatter.format(selected)} · ${weekdayNames[selected.getDay()]}`;
    document.getElementById('stat-schedule-label').textContent = selectedDate === dateKey(today) ? '今日行程' : '當日行程';
    document.getElementById('daily-date').value = selectedDate;
  }
  function render() {
    renderHeader();
    renderCalendar();
    renderTimeline();
    renderTasks();
    renderPlans();
    renderStats();
  }
  function planCoversDate(plan, date) {
    if (plan.type === 'monthly') {
      const month = date.slice(0, 7);
      return Boolean(plan.startDate && plan.endDate && month >= plan.startDate && month <= plan.endDate);
    }
    if (plan.type === 'yearly') {
      const year = Number(date.slice(0, 4));
      return Boolean(plan.startDate && plan.endDate && year >= Number(plan.startDate) && year <= Number(plan.endDate));
    }
    return false;
  }
  function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const gridStart = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1 - firstDay.getDay());
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = dateKey(day);
      const events = state.events.filter((item) => item.date === key);
      const periodPlans = state.plans.filter((plan) => planCoversDate(plan, key));
      const labels = [...events.map((item) => ({ title: item.title, kind: 'event' })), ...periodPlans.map((plan) => ({ title: plan.title, kind: 'period' }))];
      const dayClasses = ['calendar-day'];
      if (day.getMonth() !== calendarMonth.getMonth()) dayClasses.push('outside-month');
      if (key === dateKey(today)) dayClasses.push('is-today');
      if (key === selectedDate) dayClasses.push('is-selected');
      if (labels.length) dayClasses.push('has-plans');
      const preview = labels.slice(0, 2).map((item) => `<span class="calendar-item ${item.kind}">${escapeHtml(item.title)}</span>`).join('');
      const more = labels.length > 2 ? `<span class="calendar-more">+${labels.length - 2} 項</span>` : '';
      cells.push(`<button class="${dayClasses.join(' ')}" type="button" role="gridcell" data-calendar-date="${key}" aria-label="${dateFormatter.format(day)}，${labels.length} 項計畫"><span class="calendar-day-number">${day.getDate()}</span><span class="calendar-items">${preview}${more}</span></button>`);
    }
    grid.innerHTML = cells.join('');
  }
  function renderTimeline() {
    const events = state.events.filter((e) => e.date === selectedDate).sort((a, b) => a.start.localeCompare(b.start));
    const el = document.getElementById('timeline');
    const periodPlans = state.plans.filter((plan) => planCoversDate(plan, selectedDate));
    document.getElementById('agenda-count').textContent = events.length + periodPlans.length;
    if (!events.length && !periodPlans.length) { el.innerHTML = '<div class="empty-day">這天還沒有安排，新增計畫並選擇日期即可 ✳</div>'; return; }
    const eventRows = events.map((e) => {
      const hasTime = e.start && e.end;
      const timeLabel = hasTime ? `${escapeHtml(e.start)}–${escapeHtml(e.end)}` : '全天';
      let duration = '時間彈性';
      if (hasTime) {
        const [sh, sm] = e.start.split(':').map(Number), [eh, em] = e.end.split(':').map(Number);
        const mins = Math.max(0, eh * 60 + em - sh * 60 - sm);
        duration = mins >= 60 ? `${Math.floor(mins / 60)}小時${mins % 60 ? ` ${mins % 60}分` : ''}` : `${mins}分鐘`;
      }
      return `<article class="timeline-row"><time class="timeline-time">${timeLabel}</time><span class="timeline-marker"><span class="marker-dot"></span></span><div class="event-card category-${escapeHtml(e.category)}"><div><div class="event-title">${escapeHtml(e.title)}</div><div class="event-meta"><span>⌖ ${escapeHtml(e.location || '未設定地點')}</span><span>${escapeHtml(categoryLabels[e.category] || '行程')}</span></div></div><span class="event-duration">${duration}</span><button class="event-delete-button" type="button" data-delete-event="${escapeHtml(e.id)}" aria-label="刪除行程：${escapeHtml(e.title)}">×</button></div></article>`;
    }).join('');
    const periodRows = periodPlans.map((plan) => `<article class="period-agenda-row"><span class="period-agenda-tag">${escapeHtml(planTypeLabels[plan.type])}</span><strong>${escapeHtml(plan.title)}</strong></article>`).join('');
    el.innerHTML = `${eventRows}${periodRows}`;
  }
  function renderTasks() {
    document.getElementById('task-list').innerHTML = state.tasks.length ? state.tasks.map((t) => `<div class="task-row ${t.completed ? 'completed' : ''}"><button class="task-checkbox ${t.completed ? 'checked' : ''}" data-task="${escapeHtml(t.id)}" aria-label="${t.completed ? '標記未完成' : '標記完成'}：${escapeHtml(t.title)}" aria-pressed="${t.completed}">${t.completed ? '✓' : ''}</button><div class="task-copy"><div class="task-title">${escapeHtml(t.title)}</div><div class="task-subtitle">${escapeHtml(t.subtitle)}</div></div><span class="priority ${escapeHtml(t.priority)}">${escapeHtml(priorityLabels[t.priority] || '普通')}</span></div>`).join('') : '<div class="empty-day">清單空空的，今天可以安心專注 ✳</div>';
    const pending = state.tasks.filter((t) => !t.completed).length, done = state.tasks.length - pending;
    document.getElementById('task-heading-count').textContent = state.tasks.length;
    document.getElementById('stat-tasks').textContent = state.tasks.length;
    document.getElementById('progress-text').textContent = `${done} / ${state.tasks.length}`;
    document.getElementById('progress-fill').style.width = `${state.tasks.length ? Math.round(done / state.tasks.length * 100) : 0}%`;
  }
  function renderPlans() {
    const el = document.getElementById('plan-list');
    if (!el) return;
    const plans = state.plans.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    el.innerHTML = plans.length ? plans.map((plan) => {
      const period = plan.type === 'daily' ? `${plan.date ? escapeHtml(formatPlanDate(plan.date, 'daily')) : '未排日期'} · ${plan.start && plan.end ? `${escapeHtml(plan.start)}–${escapeHtml(plan.end)}` : '時間彈性'}` : `${escapeHtml(formatPlanDate(plan.startDate, plan.type))}${plan.endDate ? `–${escapeHtml(formatPlanDate(plan.endDate, plan.type))}` : ''}`;
      const detail = plan.type === 'daily' ? [plan.location, categoryLabels[plan.category] || '行程'].filter(Boolean).join(' · ') : plan.notes;
      return `<article class="saved-plan"><div class="saved-plan-copy"><span class="saved-plan-type">${escapeHtml(planTypeLabels[plan.type] || '計畫')}${period ? ` · ${period}` : ''}</span><strong>${escapeHtml(plan.title)}</strong>${detail ? `<span class="saved-plan-detail">${escapeHtml(detail)}</span>` : ''}</div><button class="delete-plan-button" type="button" data-delete-plan="${escapeHtml(plan.id)}" aria-label="刪除計畫：${escapeHtml(plan.title)}">刪除</button></article>`;
    }).join('') : '<p class="empty-plans">目前還沒有儲存的計畫。</p>';
  }
  function renderStats() {
    const events = state.events.filter((e) => e.date === selectedDate);
    document.getElementById('stat-classes').innerHTML = `${events.length} <small>筆</small>`;
  }
  function moveCalendarMonth(offset) {
    const nextMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1);
    const dayOfMonth = Number(selectedDate.slice(8, 10));
    const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    selectedDate = dateKey(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(dayOfMonth, lastDay)));
    calendarMonth = nextMonth;
    render();
  }
  document.getElementById('calendar-grid').addEventListener('click', (event) => {
    const button = event.target.closest('[data-calendar-date]');
    if (!button) return;
    selectedDate = button.dataset.calendarDate;
    const date = new Date(`${selectedDate}T00:00:00`);
    calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    render();
  });
  document.getElementById('previous-month').addEventListener('click', () => moveCalendarMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => moveCalendarMonth(1));
  document.getElementById('go-today').addEventListener('click', () => {
    selectedDate = dateKey(today);
    calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    render();
  });
  const eventForm = document.getElementById('event-form');
  const planTypeSelect = document.getElementById('plan-type');
  const startDateInput = document.getElementById('plan-start-date');
  const endDateInput = document.getElementById('plan-end-date');
  function updatePlanForm() {
    const type = planTypeSelect.value, isDaily = type === 'daily', isYearly = type === 'yearly';
    document.getElementById('daily-time-fields').hidden = !isDaily;
    eventForm.querySelectorAll('.daily-only-field').forEach((field) => { field.hidden = !isDaily; });
    document.getElementById('daily-date').required = isDaily;
    document.getElementById('daily-date').value = selectedDate;
    eventForm.elements.start.required = false;
    eventForm.elements.end.required = false;
    document.getElementById('plan-date-fields').hidden = isDaily;
    startDateInput.required = !isDaily;
    endDateInput.required = !isDaily;
    startDateInput.type = isYearly ? 'number' : 'month';
    endDateInput.type = isYearly ? 'number' : 'month';
    startDateInput.value = '';
    endDateInput.value = '';
    startDateInput.min = isYearly ? '1900' : '';
    startDateInput.max = isYearly ? '2100' : '';
    endDateInput.min = isYearly ? '1900' : '';
    endDateInput.max = isYearly ? '2100' : '';
    startDateInput.step = isYearly ? '1' : 'any';
    endDateInput.step = isYearly ? '1' : 'any';
    startDateInput.value = '';
    endDateInput.value = '';
    const periodLabel = isYearly ? '年份' : '月份';
    document.getElementById('plan-start-date-label').firstChild.textContent = `開始${periodLabel}`;
    document.getElementById('plan-end-date-label').firstChild.textContent = `結束${periodLabel}`;
    document.getElementById('submit-label').textContent = `加入${planTypeLabels[type]}`;
  }
  function initPlanForm() {
    planTypeSelect.value = 'daily';
    updatePlanForm();
  }
  planTypeSelect.addEventListener('change', updatePlanForm);
  eventForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(eventForm), type = String(values.get('planType'));
    const title = String(values.get('title')).trim();
    if (type === 'daily') {
      const start = String(values.get('start')), end = String(values.get('end'));
      const planDate = String(values.get('date') || '');
      if (!planDate) { showToast('請選擇行程日期（年、月、日）'); document.getElementById('daily-date').focus(); return; }
      if (Boolean(start) !== Boolean(end)) { showToast('開始與結束時間請都填寫，或都留空'); return; }
      if (start && end && end <= start) { showToast('結束時間需要晚於開始時間'); eventForm.elements.end.focus(); return; }
      const planId = `p-${Date.now()}`;
      state.plans.push({ id: planId, type, title, date: planDate, start, end, location: String(values.get('location')).trim(), category: String(values.get('category')), notes: String(values.get('notes')).trim(), createdAt: Date.now() });
      if (planDate) {
        state.events.push({ id: `e-${Date.now()}`, planId, date: planDate, start, end, title, location: String(values.get('location')).trim(), category: String(values.get('category')) });
        selectedDate = planDate;
        calendarMonth = new Date(Number(planDate.slice(0, 4)), Number(planDate.slice(5, 7)) - 1, 1);
      }
      save(); eventForm.reset(); planTypeSelect.value = type; updatePlanForm(); render(); showToast('已新增並儲存每日行程 ✳'); return;
    }
    const startDate = String(values.get('startDate')), endDate = String(values.get('endDate'));
    if (endDate < startDate) { showToast('結束期間不能早於開始期間'); endDateInput.focus(); return; }
    state.plans.push({ id: `p-${Date.now()}`, type, title, startDate, endDate, notes: String(values.get('notes')).trim(), createdAt: Date.now() });
    save(); eventForm.reset(); planTypeSelect.value = type; updatePlanForm(); renderPlans(); showToast(`已新增並儲存${planTypeLabels[type]} ✳`);
  });
  document.getElementById('plan-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete-plan]');
    if (!button) return;
    const planId = button.dataset.deletePlan;
    state.plans = state.plans.filter((plan) => plan.id !== planId);
    state.events = state.events.filter((item) => item.planId !== planId);
    save(); render(); showToast('已刪除計畫');
  });
  document.getElementById('timeline').addEventListener('click', (event) => {
    const button = event.target.closest('[data-delete-event]');
    if (!button) return;
    const eventId = button.dataset.deleteEvent;
    const item = state.events.find((entry) => entry.id === eventId);
    state.events = state.events.filter((entry) => entry.id !== eventId);
    if (item?.planId) state.plans = state.plans.filter((plan) => plan.id !== item.planId);
    save(); render(); showToast('已刪除行程');
  });
  const planTimeInput = document.getElementById('plan-time');
  try { planTimeInput.value = localStorage.getItem('shiguang-plan-time') || ''; } catch (_) { /* 本機儲存不可用時仍可輸入時間。 */ }
  planTimeInput.addEventListener('change', () => {
    try { localStorage.setItem('shiguang-plan-time', planTimeInput.value); showToast(planTimeInput.value ? `已記錄計畫時間 ${planTimeInput.value}` : '已清除記錄時間'); }
    catch (_) { showToast('無法在這個瀏覽器儲存時間'); }
  });
  document.getElementById('task-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-task]'); if (!button) return;
    const task = state.tasks.find((t) => t.id === button.dataset.task);
    if (task) { task.completed = !task.completed; save(); renderTasks(); showToast(task.completed ? '做得好，完成一項待辦 ✳' : '已將待辦恢復為未完成'); }
  });
  document.getElementById('theme-toggle').addEventListener('click', () => { document.body.classList.toggle('dark'); try { localStorage.setItem('shiguang-dark-mode', document.body.classList.contains('dark') ? '1' : '0'); } catch (_) { /* 瀏覽器不支援儲存時仍可切換主題。 */ } });
  try { if (localStorage.getItem('shiguang-dark-mode') === '1') document.body.classList.add('dark'); } catch (_) { /* 使用預設主題。 */ }
  render();
})();
