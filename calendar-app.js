(() => {
  'use strict';

  const STORAGE_KEY = 'shiguang-planner-v2';
  const CLOUD_MIGRATION_KEY = 'shiguang-planner-cloud-migrated-v1';
  const CLOUD_META_ID = 'meta';
  const FIREBASE_VERSION = '13.4.0';
  const planTypeLabels = { daily: '每日行程', monthly: '月計畫', yearly: '年度計畫' };
  const priorityLabels = { normal: '一般', medium: '重要', high: '最重要' };
  const priorityRank = { normal: 0, medium: 1, high: 2 };
  const comparePriorityThenTime = (a, b) => (priorityRank[b.priority] || 0) - (priorityRank[a.priority] || 0) || (a.start || '').localeCompare(b.start || '');
  const weekdayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const today = new Date();
  const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const dateFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
  const monthFormatter = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long' });
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  let selectedDate = dateKey(today);
  let calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  let state;
  let currentUser = null;
  let accountError = '';
  let firebaseServicesPromise = null;
  let cloudStateReady = false;
  let cloudPlanCache = new Map();
  let cloudMetadataCache = null;
  let editingPlanId = null;
  let dialogPlanId = null;
  let toastTimer;

  function makeWelcomeSchedule() {
    const date = dateKey(today);
    const examples = [
      { suffix: 'study', title: '範例：晨間讀書', start: '09:00', end: '10:30', location: '自習室' },
      { suffix: 'class', title: '範例：課程安排', start: '13:30', end: '15:00', location: '教室' },
      { suffix: 'break', title: '範例：休息與散步', start: '', end: '', location: '附近公園' }
    ];
    return {
      events: examples.map((item) => ({ id: `sample-e-${item.suffix}`, planId: `sample-p-${item.suffix}`, date, ...item, completed: false, isSample: true })),
      plans: examples.map((item) => ({ id: `sample-p-${item.suffix}`, type: 'daily', date, ...item, completed: false, isSample: true, createdAt: Date.now() }))
    };
  }

  function defaultState() {
    return { ...makeWelcomeSchedule(), welcomeCalendarInitialized: true, workspaceTitle: '', workspaceTitleConfigured: false };
  }

  function normalizeState(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const value = { ...defaultState(), ...source };
    value.events = Array.isArray(source.events) ? source.events : [];
    value.plans = Array.isArray(source.plans) ? source.plans : [];
    value.workspaceTitle = typeof source.workspaceTitle === 'string' ? source.workspaceTitle : '';
    value.workspaceTitleConfigured = source.workspaceTitleConfigured === true;

    if (source.welcomeCalendarInitialized !== true && value.events.length === 0 && value.plans.length === 0) {
      const examples = makeWelcomeSchedule();
      value.events = examples.events;
      value.plans = examples.plans;
    }
    value.welcomeCalendarInitialized = true;

    value.plans.forEach((plan) => {
      if (typeof plan.title !== 'string' || !plan.title.trim()) plan.title = '未命名行程';
      if (typeof plan.notes !== 'string') plan.notes = '';
      if (!Number.isSafeInteger(plan.createdAt) || plan.createdAt <= 0) plan.createdAt = Date.now();
      if (plan.type === 'daily' && !plan.date) plan.date = dateKey(today);
      if (typeof plan.completed !== 'boolean') plan.completed = false;
      if (!priorityRank[plan.priority]) plan.priority = 'normal';
    });
    value.events.forEach((event) => {
      if (!event.date) event.date = dateKey(today);
      if (typeof event.completed !== 'boolean') event.completed = false;
      if (!event.planId) event.planId = `p-${event.id || Date.now()}`;
      if (!priorityRank[event.priority]) event.priority = 'normal';
      if (!value.plans.some((plan) => plan.id === event.planId)) {
        value.plans.push({ id: event.planId, type: 'daily', title: event.title || '未命名行程', date: event.date, start: event.start || '', end: event.end || '', location: event.location || '', notes: event.notes || '', completed: event.completed, createdAt: event.createdAt || Date.now() });
      }
      const linkedPlan = value.plans.find((plan) => plan.id === event.planId);
      event.priority = linkedPlan?.priority || event.priority || 'normal';
    });
    value.plans.filter((plan) => plan.type === 'daily').forEach((plan) => {
      const linked = value.events.find((event) => event.planId === plan.id);
      if (!linked) value.events.push({ id: `e-${plan.id}`, planId: plan.id, date: plan.date || dateKey(today), title: plan.title || '未命名行程', start: plan.start || '', end: plan.end || '', location: plan.location || '', completed: Boolean(plan.completed) });
      else plan.completed = Boolean(linked.completed);
    });
    return value;
  }

  function emptyLocalState() {
    return normalizeState({
      events: [], plans: [], workspaceTitle: '', workspaceTitleConfigured: false,
      welcomeCalendarInitialized: true
    });
  }

  function loadLocalState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw) return normalizeState(raw);
      const legacy = JSON.parse(localStorage.getItem('shiguang-student-planner-v1'));
      if (legacy) return normalizeState(legacy);
    } catch (error) { console.warn('讀取本機行程失敗，改用範例行程。', error); }
    return defaultState();
  }

  state = loadLocalState();

  function showToast(message) {
    const element = document.getElementById('toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
  }

  function firebaseErrorMessage(error) {
    const code = error?.code || '';
    if (code === 'auth/operation-not-allowed') return 'Firebase 尚未啟用 Google 登入，請到 Authentication 啟用 Google 提供者。';
    if (code === 'auth/unauthorized-domain') return '目前網站網域尚未加入 Firebase 授權網域。';
    if (code === 'auth/popup-blocked') return '瀏覽器封鎖了登入視窗，請允許此網站開啟彈出視窗。';
    if (code === 'auth/popup-closed-by-user') return '登入視窗已關閉，尚未完成登入。';
    if (code === 'auth/network-request-failed') return '網路連線失敗，請確認網路後再試。';
    if (code === 'firestore/permission-denied') return 'Firestore 拒絕存取，請檢查專案安全規則。';
    if (code === 'unavailable' || code === 'firestore/unavailable') return 'Firestore 暫時無法連線，請檢查網路後重試。';
    return error?.message || 'Firebase 連線失敗，請檢查專案設定。';
  }

  async function getFirebaseServices() {
    if (!firebaseServicesPromise) {
      firebaseServicesPromise = (async () => {
        const { firebaseConfig } = await import('./firebase-config.js');
        if (!firebaseConfig?.apiKey || firebaseConfig.apiKey.startsWith('YOUR_') || !firebaseConfig.authDomain || !firebaseConfig.appId) {
          throw new Error('Firebase Web app 設定尚未填妥。');
        }
        const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
        const [appSdk, authSdk, firestoreSdk] = await Promise.all([
          import(`${base}/firebase-app.js`),
          import(`${base}/firebase-auth.js`),
          import(`${base}/firebase-firestore.js`)
        ]);
        const app = appSdk.initializeApp(firebaseConfig);
        return {
          auth: authSdk.getAuth(app),
          provider: new authSdk.GoogleAuthProvider(),
          authSdk,
          firestore: firestoreSdk.getFirestore(app),
          firestoreSdk
        };
      })().catch((error) => {
        firebaseServicesPromise = null;
        throw error;
      });
    }
    return firebaseServicesPromise;
  }

  function updateAccount() {
    const button = document.getElementById('auth-button');
    document.getElementById('account-name').textContent = currentUser?.displayName || currentUser?.email || '尚未登入';
    document.getElementById('account-status').textContent = accountError || (currentUser ? (cloudStateReady ? 'Firebase 已登入 · 行程已同步至雲端' : 'Firebase 已登入 · 正在載入行程…') : '登入以載入你的雲端行程');
    const avatar = document.getElementById('account-avatar');
    avatar.replaceChildren();
    if (currentUser?.photoURL) {
      const image = document.createElement('img');
      image.src = currentUser.photoURL;
      image.alt = `${currentUser.displayName || 'Google'} 頭像`;
      image.referrerPolicy = 'no-referrer';
      avatar.append(image);
    } else avatar.textContent = currentUser?.displayName?.trim()?.slice(0, 1) || currentUser?.email?.slice(0, 1) || '✳';
    button.textContent = currentUser ? '登出' : 'Google 登入';
    button.disabled = false;
  }

  function getWorkspaceTitle() {
    return state.workspaceTitle.trim() || (currentUser?.displayName ? `${currentUser.displayName} 的行事曆` : '我的行事曆');
  }

  function renderHeader() {
    document.getElementById('header-date').textContent = dateFormatter.format(today);
    document.getElementById('today-date').textContent = dateFormatter.format(today);
    document.getElementById('day-name').textContent = weekdayNames[today.getDay()];
    document.getElementById('calendar-month-label').textContent = monthFormatter.format(calendarMonth);
    document.getElementById('selected-day-label').textContent = `${dateFormatter.format(new Date(`${selectedDate}T00:00:00`))} · ${weekdayNames[new Date(`${selectedDate}T00:00:00`).getDay()]}`;
    document.getElementById('workspace-title').textContent = getWorkspaceTitle();
    document.title = `${getWorkspaceTitle()} · 拾光`;
    updateAccount();
  }

  function planCoversDate(plan, date) {
    if (plan.type === 'monthly') {
      const month = plan.month || plan.startDate || '';
      if (plan.month) return date.slice(0, 7) === plan.month;
      return Boolean(month && plan.endDate && date.slice(0, 7) >= month && date.slice(0, 7) <= plan.endDate);
    }
    if (plan.type === 'yearly') {
      const year = String(plan.year || plan.startDate || '');
      if (plan.year) return date.slice(0, 4) === year;
      return Boolean(year && plan.endDate && Number(date.slice(0, 4)) >= Number(year) && Number(date.slice(0, 4)) <= Number(plan.endDate));
    }
    return false;
  }

  function formatPlanDate(plan) {
    if (plan.type === 'daily') return plan.date ? dateFormatter.format(new Date(`${plan.date}T00:00:00`)) : '未設定日期';
    if (plan.type === 'monthly') {
      const month = plan.month || plan.startDate;
      return month ? `${month.replace('-', '年')}月` : '未設定月份';
    }
    const year = plan.year || plan.startDate;
    return year ? `${year}年` : '未設定年份';
  }

  function getPlanForEvent(event) {
    const linked = state.plans.find((plan) => plan.id === event.planId);
    if (linked) return linked;
    return state.plans.find((plan) => plan.type === 'daily' && plan.title === event.title && plan.date === event.date) || {
      id: event.planId || event.id, type: 'daily', title: event.title || '未命名行程', date: event.date, priority: event.priority || 'normal',
      start: event.start || '', end: event.end || '', location: event.location || '', notes: event.notes || '', completed: Boolean(event.completed)
    };
  }

  function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const gridStart = new Date(firstDay.getFullYear(), firstDay.getMonth(), 1 - firstDay.getDay());
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
      const key = dateKey(day);
      const dayEvents = state.events.filter((event) => event.date === key).sort(comparePriorityThenTime);
      const periodPlans = state.plans.filter((plan) => plan.type !== 'daily' && planCoversDate(plan, key));
      const items = [
        ...dayEvents.map((event) => ({ id: getPlanForEvent(event).id, title: event.title, completed: event.completed, kind: 'event' })),
        ...periodPlans.map((plan) => ({ id: plan.id, title: plan.title, completed: Boolean(plan.completed), kind: 'period' }))
      ];
      const classes = ['calendar-day'];
      if (day.getMonth() !== calendarMonth.getMonth()) classes.push('outside-month');
      if (key === dateKey(today)) classes.push('is-today');
      if (key === selectedDate) classes.push('is-selected');
      if (items.length) classes.push('has-plans');
      const previews = items.slice(0, 3).map((item) => `<button type="button" class="calendar-item ${item.kind}${item.completed ? ' is-complete' : ''}" data-open-plan-id="${escapeHtml(item.id)}" aria-label="開啟行程：${escapeHtml(item.title)}">${escapeHtml(item.title)}</button>`).join('');
      const more = items.length > 3 ? `<span class="calendar-more">+${items.length - 3} 項</span>` : '';
      cells.push(`<div class="${classes.join(' ')}" role="gridcell"><button type="button" class="calendar-day-number" data-select-date="${key}" aria-label="選擇 ${dateFormatter.format(day)}">${day.getDate()}</button><div class="calendar-items">${previews}${more}</div></div>`);
    }
    grid.innerHTML = cells.join('');
  }

  function renderAgenda() {
    const events = state.events.filter((event) => event.date === selectedDate).sort(comparePriorityThenTime);
    const periodPlans = state.plans.filter((plan) => plan.type !== 'daily' && planCoversDate(plan, selectedDate));
    const total = events.length + periodPlans.length;
    document.getElementById('agenda-count').textContent = total;
    const rows = events.map((event) => {
      const plan = getPlanForEvent(event);
      const time = event.start && event.end ? `${escapeHtml(event.start)}–${escapeHtml(event.end)}` : '全天';
      const priority = `<small class="priority-label">${priorityLabels[event.priority] || '一般'}</small>`;
      return `<button type="button" class="agenda-event-card priority-${escapeHtml(event.priority || 'normal')}${event.completed ? ' is-complete' : ''}" data-open-plan-id="${escapeHtml(plan.id)}"><span class="agenda-event-time">${time}</span><span class="agenda-event-copy"><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.location || '未設定地點')}</small></span>${priority}<span class="agenda-event-arrow">›</span></button>`;
    }).join('');
    const periodRows = periodPlans.map((plan) => `<button type="button" class="period-agenda-row${plan.completed ? ' is-complete' : ''}" data-open-plan-id="${escapeHtml(plan.id)}"><span class="period-agenda-tag">${planTypeLabels[plan.type]}</span><strong>${escapeHtml(plan.title)}</strong><span class="agenda-event-arrow">›</span></button>`).join('');
    document.getElementById('timeline').innerHTML = total ? `${rows}${periodRows}` : '<div class="empty-day">這一天還沒有行程。使用下方「新增行程」來安排。</div>';
  }

  function renderTodos() {
    const incomplete = state.plans.filter((plan) => !plan.completed).sort((a, b) => `${a.date || a.month || a.year || ''} ${a.start || ''}`.localeCompare(`${b.date || b.month || b.year || ''} ${b.start || ''}`));
    const complete = state.plans.filter((plan) => plan.completed).length;
    const total = state.plans.length;
    document.getElementById('todo-count').textContent = incomplete.length;
    document.getElementById('nav-todo-count').textContent = incomplete.length;
    document.getElementById('progress-text').textContent = `${complete} / ${total}`;
    document.getElementById('progress-fill').style.width = `${total ? Math.round(complete / total * 100) : 0}%`;
    const list = document.getElementById('task-list');
    if (!incomplete.length) {
      list.innerHTML = '<div class="empty-todos">目前沒有待辦計畫。新增每日、月或年度計畫後會自動列在這裡。</div>';
      return;
    }
    list.innerHTML = incomplete.map((plan) => {
      const time = plan.type === 'daily' && plan.start && plan.end ? ` · ${plan.start}–${plan.end}` : '';
      return `<article class="todo-row"><button class="task-checkbox" type="button" data-complete-plan-id="${escapeHtml(plan.id)}" aria-label="標記完成：${escapeHtml(plan.title)}" aria-pressed="false"></button><button class="todo-event-copy" type="button" data-open-plan-id="${escapeHtml(plan.id)}"><strong>${escapeHtml(plan.title)}</strong><span>${escapeHtml(formatPlanDate(plan))}${escapeHtml(time)}</span></button></article>`;
    }).join('');
  }

  function renderSavedPlans() {
    const plans = state.plans.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const list = document.getElementById('plan-list');
    list.innerHTML = plans.length ? plans.map((plan) => `<button type="button" class="saved-plan${plan.completed ? ' is-complete' : ''}" data-open-plan-id="${escapeHtml(plan.id)}"><span class="saved-plan-copy"><span class="saved-plan-type">${planTypeLabels[plan.type] || '行程'} · ${escapeHtml(formatPlanDate(plan))}</span><strong>${escapeHtml(plan.title)}</strong></span><span class="saved-plan-arrow">›</span></button>`).join('') : '<p class="empty-plans">尚未儲存計畫。</p>';
  }

  function render() {
    renderHeader();
    renderCalendar();
    renderAgenda();
    renderTodos();
    renderSavedPlans();
  }

  function updatePlanForm() {
    const type = document.getElementById('plan-type').value;
    const daily = type === 'daily';
    document.querySelectorAll('.daily-field').forEach((field) => { field.hidden = !daily; });
    document.querySelector('.monthly-field').hidden = type !== 'monthly';
    document.querySelector('.yearly-field').hidden = type !== 'yearly';
    const date = document.getElementById('daily-date');
    const month = document.getElementById('plan-month');
    const year = document.getElementById('plan-year');
    date.required = daily;
    month.required = type === 'monthly';
    year.required = type === 'yearly';
    if (daily && !date.value) date.value = selectedDate;
  }

  const form = document.getElementById('event-form');
  const planTypeInput = document.getElementById('plan-type');
  const planDialog = document.getElementById('plan-dialog');
  const titleDialog = document.getElementById('title-dialog');

  function resetPlanForm() {
    editingPlanId = null;
    form.reset();
    planTypeInput.value = 'daily';
    document.getElementById('daily-date').value = selectedDate;
    document.getElementById('add-event-heading').textContent = '新增行程';
    document.getElementById('submit-label').textContent = '加入行程';
    document.getElementById('cancel-edit-button').hidden = true;
    updatePlanForm();
  }

  function findPlan(planId) {
    const known = state.plans.find((plan) => plan.id === planId);
    if (known) return known;
    const event = state.events.find((item) => item.id === planId || item.planId === planId);
    return event ? getPlanForEvent(event) : null;
  }

  function openPlanDialog(planId) {
    const plan = findPlan(planId);
    if (!plan) return;
    dialogPlanId = plan.id;
    document.getElementById('dialog-type').textContent = planTypeLabels[plan.type] || '行程';
    document.getElementById('dialog-title').textContent = plan.title || '未命名行程';
    document.getElementById('dialog-date').textContent = formatPlanDate(plan);
    document.getElementById('dialog-time').textContent = plan.type === 'daily' ? (plan.start && plan.end ? `${plan.start}–${plan.end}` : '時間未指定') : '';
    document.getElementById('dialog-priority').textContent = `重要程度：${priorityLabels[plan.priority] || '一般'}`;
    document.getElementById('dialog-location').textContent = plan.location ? `地點：${plan.location}` : '';
    document.getElementById('dialog-notes').textContent = plan.notes ? `備註：${plan.notes}` : '';
    const completeButton = document.getElementById('toggle-complete-button');
    completeButton.hidden = false;
    completeButton.textContent = plan.completed ? '標記未完成' : '標記完成';
    planDialog.showModal();
  }

  function planMatchesEvent(event, plan) {
    return event.planId === plan.id || (!event.planId && plan.type === 'daily' && event.title === plan.title && event.date === plan.date);
  }

  async function deletePlan(planId) {
    const plan = findPlan(planId);
    if (!plan) return;
    state.plans = state.plans.filter((item) => item.id !== plan.id);
    state.events = state.events.filter((event) => !planMatchesEvent(event, plan));
    if (!await save()) { render(); return; }
    render();
    showToast('已刪除行程');
  }

  function beginPlanEdit(planId) {
    const plan = findPlan(planId);
    if (!plan) return;
    editingPlanId = plan.id;
    form.reset();
    planTypeInput.value = plan.type || 'daily';
    document.getElementById('plan-title').value = plan.title || '';
    document.getElementById('plan-priority').value = plan.priority || 'normal';
    document.getElementById('daily-date').value = plan.date || selectedDate;
    document.getElementById('plan-month').value = plan.month || plan.startDate || '';
    document.getElementById('plan-year').value = plan.year || plan.startDate || '';
    document.getElementById('plan-start').value = plan.start || '';
    document.getElementById('plan-end').value = plan.end || '';
    document.getElementById('plan-location').value = plan.location || '';
    document.getElementById('plan-notes').value = plan.notes || '';
    document.getElementById('add-event-heading').textContent = '更改行程';
    document.getElementById('submit-label').textContent = '儲存更改';
    document.getElementById('cancel-edit-button').hidden = false;
    updatePlanForm();
    if (planDialog.open) planDialog.close();
    document.getElementById('add-event').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('plan-title').focus({ preventScroll: true });
  }

  function moveCalendarMonth(offset) {
    const next = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1);
    const wantedDay = Number(selectedDate.slice(8, 10));
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    selectedDate = dateKey(new Date(next.getFullYear(), next.getMonth(), Math.min(wantedDay, lastDay)));
    calendarMonth = next;
    render();
  }

  function getPlannerCollection(services, userId) {
    return services.firestoreSdk.collection(services.firestore, 'users', userId, 'planner');
  }

  function serializablePlan(plan) {
    const fields = ['id', 'type', 'title', 'priority', 'notes', 'createdAt', 'completed', 'date', 'month', 'year', 'start', 'end', 'location'];
    return Object.fromEntries(fields.filter((field) => plan[field] !== undefined).map((field) => [field, plan[field]]));
  }

  function getCloudMetadata() {
    return {
      workspaceTitle: state.workspaceTitle,
      workspaceTitleConfigured: state.workspaceTitleConfigured === true
    };
  }

  async function writeCloudState(services, userId, {forceAll = false} = {}) {
    const sdk = services.firestoreSdk;
    const collectionRef = getPlannerCollection(services, userId);
    const nextPlans = new Map(state.plans.filter((plan) => !plan.isSample).map((plan) => [String(plan.id), serializablePlan(plan)]));
    const nextMetadata = getCloudMetadata();
    const batch = sdk.writeBatch(services.firestore);
    let writes = 0;

    nextPlans.forEach((plan, id) => {
      if (forceAll || JSON.stringify(plan) !== JSON.stringify(cloudPlanCache.get(id))) {
        batch.set(sdk.doc(collectionRef, id), plan);
        writes += 1;
      }
    });
    cloudPlanCache.forEach((_, id) => {
      if (!nextPlans.has(id)) {
        batch.delete(sdk.doc(collectionRef, id));
        writes += 1;
      }
    });
    if (forceAll || JSON.stringify(nextMetadata) !== JSON.stringify(cloudMetadataCache)) {
      batch.set(sdk.doc(collectionRef, CLOUD_META_ID), nextMetadata);
      writes += 1;
    }

    if (writes > 500) throw new Error('單次同步行程超過 Firestore 寫入上限，請分批刪減後再試。');
    if (writes) await batch.commit();
    cloudPlanCache = nextPlans;
    cloudMetadataCache = nextMetadata;
  }

  async function save() {
    try {
      if (currentUser && cloudStateReady) {
        const services = await getFirebaseServices();
        await writeCloudState(services, currentUser.uid);
        accountError = '';
        updateAccount();
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
      return true;
    } catch (error) {
      console.error('儲存行程失敗。', error);
      accountError = currentUser ? '雲端同步失敗，請確認網路或 Firebase 規則後重試。' : '本機儲存失敗，請檢查瀏覽器設定。';
      updateAccount();
      showToast(accountError);
      return false;
    }
  }

  function setPlannerState(raw) {
    state = normalizeState(raw);
    render();
  }

  async function loadUserState(user, services) {
    currentUser = user;
    accountError = '';
    cloudStateReady = false;
    cloudPlanCache = new Map();
    cloudMetadataCache = null;
    render();
    document.getElementById('account-status').textContent = 'Firebase 已登入 · 正在載入行程…';

    const sdk = services.firestoreSdk;
    const collectionRef = getPlannerCollection(services, user.uid);
    const [plansSnapshot, metadataSnapshot] = await Promise.all([
      sdk.getDocs(collectionRef),
      sdk.getDoc(sdk.doc(collectionRef, CLOUD_META_ID))
    ]);
    const cloudPlans = new Map();
    plansSnapshot.forEach((snapshot) => {
      if (snapshot.id !== CLOUD_META_ID && snapshot.id !== 'state') {
        cloudPlans.set(snapshot.id, serializablePlan({id: snapshot.id, ...snapshot.data()}));
      }
    });
    const legacyStateSnapshot = await sdk.getDoc(sdk.doc(collectionRef, 'state'));
    const migrationKey = `${CLOUD_MIGRATION_KEY}:${user.uid}`;
    const localOwner = localStorage.getItem(`${CLOUD_MIGRATION_KEY}:owner`);
    const isFirstCloudLogin = cloudPlans.size === 0 && !metadataSnapshot.exists() && !legacyStateSnapshot.exists() && !localStorage.getItem(migrationKey);

    if (cloudPlans.size === 0 && legacyStateSnapshot.exists() && !metadataSnapshot.exists()) {
      const legacy = legacyStateSnapshot.data();
      state = normalizeState({
        ...legacy,
        events: Array.isArray(legacy.events) ? legacy.events.filter((event) => !event.isSample) : [],
        plans: Array.isArray(legacy.plans) ? legacy.plans.filter((plan) => !plan.isSample) : [],
        welcomeCalendarInitialized: true
      });
      cloudPlanCache = new Map();
      cloudMetadataCache = null;
      cloudStateReady = true;
      await writeCloudState(services, user.uid, {forceAll: true});
      localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyLocalState()));
      localStorage.setItem(migrationKey, '1');
      localStorage.setItem(`${CLOUD_MIGRATION_KEY}:owner`, user.uid);
    } else if (isFirstCloudLogin && (!localOwner || localOwner === user.uid)) {
      const localState = loadLocalState();
      state = normalizeState({
        ...localState,
        events: [],
        plans: localState.plans.filter((plan) => !plan.isSample),
        welcomeCalendarInitialized: true
      });
      cloudPlanCache = new Map();
      cloudMetadataCache = null;
      cloudStateReady = true;
      await writeCloudState(services, user.uid, {forceAll: true});
      localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyLocalState()));
      localStorage.setItem(migrationKey, '1');
      localStorage.setItem(`${CLOUD_MIGRATION_KEY}:owner`, user.uid);
    } else {
      const metadata = metadataSnapshot.exists() ? metadataSnapshot.data() : {};
      state = normalizeState({
        events: [],
        plans: Array.from(cloudPlans.values()),
        workspaceTitle: typeof metadata.workspaceTitle === 'string' ? metadata.workspaceTitle : '',
        workspaceTitleConfigured: metadata.workspaceTitleConfigured === true,
        welcomeCalendarInitialized: true
      });
      cloudPlanCache = cloudPlans;
      cloudMetadataCache = metadataSnapshot.exists() ? getCloudMetadata() : null;
      cloudStateReady = true;
      localStorage.setItem(migrationKey, '1');
    }
    render();
    if (!state.workspaceTitleConfigured) openTitleDialog(true);
  }

  async function startFirebase() {
    const button = document.getElementById('auth-button');
    const status = document.getElementById('account-status');
    status.textContent = '連線 Firebase…';
    try {
      const services = await getFirebaseServices();
      services.authSdk.onAuthStateChanged(services.auth, async (user) => {
        try {
          if (user) await loadUserState(user, services);
          else {
            const migratedOwner = localStorage.getItem(`${CLOUD_MIGRATION_KEY}:owner`);
            currentUser = null;
            accountError = '';
            cloudStateReady = false;
            cloudPlanCache = new Map();
            cloudMetadataCache = null;
            state = migratedOwner ? emptyLocalState() : loadLocalState();
            render();
          }
        } catch (error) {
          console.error(error);
          accountError = firebaseErrorMessage(error);
          showToast(firebaseErrorMessage(error));
        }
        updateAccount();
      });
      button.disabled = false;
    } catch (error) {
      console.error(error);
      accountError = firebaseErrorMessage(error);
      status.textContent = 'Firebase 尚未連線';
      button.disabled = false;
      button.title = firebaseErrorMessage(error);
    }
  }

  document.getElementById('auth-button').addEventListener('click', async () => {
    try {
      accountError = '';
      updateAccount();
      const services = await getFirebaseServices();
      if (currentUser) await services.authSdk.signOut(services.auth);
      else await services.authSdk.signInWithPopup(services.auth, services.provider);
    } catch (error) {
      console.error(error);
      accountError = firebaseErrorMessage(error);
      showToast(accountError);
      updateAccount();
    }
  });

  document.getElementById('calendar-grid').addEventListener('click', (event) => {
    const planButton = event.target.closest('[data-open-plan-id]');
    if (planButton) { openPlanDialog(planButton.dataset.openPlanId); return; }
    const dateButton = event.target.closest('[data-select-date]');
    if (!dateButton) return;
    selectedDate = dateButton.dataset.selectDate;
    const date = new Date(`${selectedDate}T00:00:00`);
    calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    document.getElementById('daily-date').value = selectedDate;
    render();
  });
  document.getElementById('timeline').addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-plan-id]');
    if (button) openPlanDialog(button.dataset.openPlanId);
  });
  document.getElementById('task-list').addEventListener('click', async (event) => {
    const completeButton = event.target.closest('[data-complete-plan-id]');
    const planButton = event.target.closest('[data-open-plan-id]');
    if (planButton) { openPlanDialog(planButton.dataset.openPlanId); return; }
    if (!completeButton) return;
    const plan = findPlan(completeButton.dataset.completePlanId);
    if (!plan) return;
    plan.completed = !plan.completed;
    state.events.filter((item) => planMatchesEvent(item, plan)).forEach((item) => { item.completed = plan.completed; });
    if (!await save()) { render(); return; }
    render();
    showToast(plan.completed ? '已完成這項計畫' : '已恢復為待辦');
  });

  document.getElementById('previous-month').addEventListener('click', () => moveCalendarMonth(-1));
  document.getElementById('next-month').addEventListener('click', () => moveCalendarMonth(1));
  document.getElementById('go-today').addEventListener('click', () => {
    selectedDate = dateKey(today);
    calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('daily-date').value = selectedDate;
    render();
  });

  planTypeInput.addEventListener('change', updatePlanForm);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const type = String(values.get('planType'));
    const title = String(values.get('title') || '').trim();
    if (!title) { document.getElementById('plan-title').focus(); return; }
    const previous = editingPlanId ? findPlan(editingPlanId) : null;
    const id = previous?.id || `p-${Date.now()}`;
    const priority = String(values.get('priority') || 'normal');
    const nextPlan = { id, type, title, priority: priorityRank[priority] !== undefined ? priority : 'normal', notes: String(values.get('notes') || '').trim(), createdAt: previous?.createdAt || Date.now(), completed: previous?.completed || false };
    if (type === 'daily') {
      nextPlan.date = String(values.get('date') || '');
      nextPlan.start = String(values.get('start') || '');
      nextPlan.end = String(values.get('end') || '');
      nextPlan.location = String(values.get('location') || '').trim();
      if (!nextPlan.date) { showToast('每日行程需要選擇完整日期。'); document.getElementById('daily-date').focus(); return; }
      if (Boolean(nextPlan.start) !== Boolean(nextPlan.end)) { showToast('開始與結束時間請一起填寫，或都留空。'); return; }
      if (nextPlan.start && nextPlan.end && nextPlan.end <= nextPlan.start) { showToast('結束時間需要晚於開始時間。'); return; }
    } else if (type === 'monthly') {
      nextPlan.month = String(values.get('month') || '');
      if (!nextPlan.month) { showToast('請選擇計畫月份。'); document.getElementById('plan-month').focus(); return; }
    } else {
      nextPlan.year = String(values.get('year') || '');
      if (!/^\d{4}$/.test(nextPlan.year) || Number(nextPlan.year) < 1900 || Number(nextPlan.year) > 2100) { showToast('請輸入 1900 至 2100 年之間的年份。'); document.getElementById('plan-year').focus(); return; }
    }

    if (previous) {
      state.plans = state.plans.map((plan) => plan.id === previous.id ? nextPlan : plan);
      state.events = state.events.filter((item) => !planMatchesEvent(item, previous));
    } else state.plans.push(nextPlan);
    if (type === 'daily') {
      state.events.push({ id: previous && state.events.some((item) => item.id === `e-${id}`) ? `e-${id}` : `e-${Date.now()}`, planId: id, date: nextPlan.date, title, priority: nextPlan.priority, start: nextPlan.start, end: nextPlan.end, location: nextPlan.location, completed: nextPlan.completed });
      selectedDate = nextPlan.date;
      const date = new Date(`${selectedDate}T00:00:00`);
      calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    } else if (type === 'monthly') {
      selectedDate = `${nextPlan.month}-01`;
      const date = new Date(`${selectedDate}T00:00:00`);
      calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    } else {
      selectedDate = `${nextPlan.year}-01-01`;
      calendarMonth = new Date(Number(nextPlan.year), 0, 1);
    }
    if (!await save()) { render(); return; }
    resetPlanForm();
    render();
    showToast(previous ? '行程已更新' : `${planTypeLabels[type]}已新增`);
  });

  document.getElementById('cancel-edit-button').addEventListener('click', resetPlanForm);
  document.getElementById('edit-plan-button').addEventListener('click', () => { if (dialogPlanId) beginPlanEdit(dialogPlanId); });
  document.getElementById('delete-plan-button').addEventListener('click', async () => {
    if (dialogPlanId) await deletePlan(dialogPlanId);
    if (planDialog.open) planDialog.close();
  });
  document.getElementById('toggle-complete-button').addEventListener('click', async () => {
    const plan = findPlan(dialogPlanId);
    if (!plan) return;
    plan.completed = !plan.completed;
    state.events.filter((item) => planMatchesEvent(item, plan)).forEach((item) => { item.completed = plan.completed; });
    if (!await save()) return;
    planDialog.close();
    render();
    showToast(plan.completed ? '已完成計畫' : '已恢復為待辦');
  });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => {
    const dialog = document.getElementById(button.dataset.closeDialog);
    if (dialog?.open) dialog.close();
  }));
  function openTitleDialog(firstTime = false) {
    document.getElementById('title-input').value = state.workspaceTitle || (currentUser?.displayName ? `${currentUser.displayName} 的行事曆` : getWorkspaceTitle());
    document.getElementById('title-dialog-heading').textContent = firstTime ? '歡迎使用行事曆' : '更改行事曆名稱';
    document.getElementById('title-dialog-hint').textContent = firstTime ? '替你的行事曆設定名稱，之後點上方標題即可修改。' : '輸入新的行事曆名稱。';
    document.getElementById('title-submit-label').textContent = firstTime ? '開始使用' : '儲存';
    titleDialog.showModal();
  }
  document.getElementById('workspace-title').addEventListener('click', () => openTitleDialog());
  document.getElementById('title-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    state.workspaceTitle = document.getElementById('title-input').value.trim();
    state.workspaceTitleConfigured = true;
    if (!await save()) return;
    renderHeader();
    titleDialog.close();
    showToast('行事曆名稱已儲存');
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    try { localStorage.setItem('shiguang-dark-mode', document.body.classList.contains('dark') ? '1' : '0'); } catch (_) { /* 主題仍可在目前頁面切換。 */ }
  });
  try { if (localStorage.getItem('shiguang-dark-mode') === '1') document.body.classList.add('dark'); } catch (_) { /* 使用預設主題。 */ }

  planTypeInput.value = 'daily';
  updatePlanForm();
  render();
  startFirebase();
})();
