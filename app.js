'use strict';

// ===== SM-2 SPACED REPETITION ALGORITHM =====
const SM2 = {
 // ratings: 0=Again, 1=Hard, 2=Good, 3=Easy
 // maps to SM-2 quality scores: 0→1, 1→3, 2→4, 3→5
 QUALITY_MAP: [1, 3, 4, 5],

 process(card, rating) {
 const q = this.QUALITY_MAP[rating];
 let { interval, repetition, easeFactor, dueDate } = card;

 if (q < 3) {
 repetition = 0;
 interval = 1;
 } else {
 if (repetition === 0) interval = 1;
 else if (repetition === 1) interval = 6;
 else interval = Math.round(interval * easeFactor);

 easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
 easeFactor = Math.max(1.3, parseFloat(easeFactor.toFixed(2)));
 repetition += 1;
 }

 dueDate = this.addDays(new Date(), interval).toISOString().split('T')[0];
 return { interval, repetition, easeFactor, dueDate };
 },

 addDays(date, days) {
 const d = new Date(date);
 d.setDate(d.getDate() + days);
 return d;
 },

 isDue(card) {
 const today = new Date().toISOString().split('T')[0];
 return card.dueDate <= today;
 }
};

// ===== STORAGE =====
const Storage = {
 KEY_CARDS: 'medcards_cards',
 KEY_STATS: 'medcards_stats',

 getCards() {
 try { return JSON.parse(localStorage.getItem(this.KEY_CARDS) || '[]'); }
 catch { return []; }
 },

 saveCards(cards) {
 localStorage.setItem(this.KEY_CARDS, JSON.stringify(cards));
 },

 getStats() {
 const defaults = { totalReviews: 0, correctReviews: 0, daysStudied: {}, streak: 0, lastStudied: '' };
 try { return { ...defaults, ...JSON.parse(localStorage.getItem(this.KEY_STATS) || '{}') }; }
 catch { return defaults; }
 },

 saveStats(stats) {
 localStorage.setItem(this.KEY_STATS, JSON.stringify(stats));
 }
};

// ===== APP STATE =====
let state = {
 allCards: [], // All cards loaded from JSON
 cards: [], // Cards currently in use (after syncing with localStorage)
 stats: {},
 currentView: 'dashboard',
 studyQueue: [],
 studyIndex: 0,
 studyTotal: 0,
 pendingDeleteId: null,
 filterCategory: '',
 filterSearch: ''
};

// ===== INIT =====
async function init() {
 await loadAllCards();
 state.stats = Storage.getStats();

 const storedCards = Storage.getCards();
 if (storedCards.length > 0) {
 state.cards = storedCards;
 } else if (state.allCards.length > 0) {
 // First time load, use the fetched cards
 loadSampleCards();
 }

 updateStreak();
 bindEvents();
 renderAll();
 showView('dashboard');
}

async function loadAllCards() {
 try {
 const response = await fetch('cards.json');
 if (!response.ok) {
 throw new Error(`HTTP error! status: ${response.status}`);
 }
 state.allCards = await response.json();
 console.log(`Loaded ${state.allCards.length} cards from cards.json`);
 } catch (error) {
 console.error("Could not load cards.json:", error);
 // You could have fallback logic here if needed
 }
}

function loadSampleCards() {
 const today = new Date().toISOString().split('T')[0];
 state.cards = state.allCards.map((c, i) => ({
 id: generateId(),
 ...c,
 interval: 0,
 repetition: 0,
 easeFactor: 2.5,
 dueDate: today,
 createdAt: today,
 reviewCount: 0,
 status: 'new'
 }));
 Storage.saveCards(state.cards);
}

function generateId() {
 return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ===== STREAK =====
function updateStreak() {
 const today = new Date().toISOString().split('T')[0];
 const stats = state.stats;

 if (stats.lastStudied === today) return;

 const yesterday = SM2.addDays(new Date(), -1).toISOString().split('T')[0];
 if (stats.lastStudied === yesterday) {
 stats.streak = (stats.streak || 0) + 1;
 } else if (stats.lastStudied !== today) {
 stats.streak = stats.streak || 0;
 }
}

// ===== EVENTS =====
function bindEvents() {
 // Nav buttons
 document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
 btn.addEventListener('click', () => showView(btn.dataset.view));
 });

 // Buttons with data-view inside views
 document.querySelectorAll('[data-view]:not(.nav-btn)').forEach(el => {
 el.addEventListener('click', () => showView(el.dataset.view));
 });

 // Dashboard start study
 document.getElementById('start-study-btn').addEventListener('click', () => showView('study'));

 // Flip card
 document.getElementById('flip-btn').addEventListener('click', flipCard);
 document.getElementById('flashcard').addEventListener('click', flipCard);

 // Rating buttons
 document.querySelectorAll('.rating-btn').forEach(btn => {
 btn.addEventListener('click', () => rateCard(parseInt(btn.dataset.rating)));
 });

 // Search & filter
 document.getElementById('search-input').addEventListener('input', e => {
 state.filterSearch = e.target.value;
 renderBrowse();
 });

 document.getElementById('filter-category').addEventListener('change', e => {
 state.filterCategory = e.target.value;
 renderBrowse();
 });

 // Card form
 document.getElementById('card-form').addEventListener('submit', handleFormSubmit);
 document.getElementById('cancel-form-btn').addEventListener('click', () => showView('browse'));

 // Modal
 document.getElementById('modal-cancel').addEventListener('click', () => {
 document.getElementById('modal').style.display = 'none';
 state.pendingDeleteId = null;
 });
 document.getElementById('modal-confirm').addEventListener('click', confirmDelete);
}

// ===== VIEWS =====
function showView(viewId, params = {}) {
    state.currentView = viewId;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const viewEl = document.getElementById('view-' + viewId);
    if (viewEl) viewEl.classList.add('active');

    const navBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
    if (navBtn) navBtn.classList.add('active');

    if (viewId === 'dashboard') renderDashboard();
    if (viewId === 'study') startStudySession(params.category);
    if (viewId === 'browse') renderBrowse();
    if (viewId === 'stats') renderStats();
    if (viewId === 'create') resetForm();
}

// ===== RENDER ALL =====
function renderAll() {
 renderSidebar();
 updateDueBadge();
 renderDashboard();
}

// ===== SIDEBAR =====
function renderSidebar() {
    const categories = getCategoryCounts();
    const list = document.getElementById('category-list');
    list.innerHTML = '';

    Object.entries(categories).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
        const chip = document.createElement('div');
        chip.className = 'cat-chip';
        chip.innerHTML = `<span>${cat}</span><span class="cat-chip-count">${count}</span>`;
        chip.addEventListener('click', () => {
            showView('study', { category: cat });
        });
        list.appendChild(chip);
    });
}

function getCategoryCounts() {
 const counts = {};
 state.cards.forEach(c => {
 counts[c.cat] = (counts[c.cat] || 0) + 1;
 });
 return counts;
}

function updateDueBadge() {
 const dueCount = getDueCards().length;
 const badge = document.getElementById('due-badge');
 badge.textContent = dueCount > 0 ? dueCount : '';
}

function getDueCards() {
 return state.cards.filter(c => SM2.isDue(c));
}

// ===== DASHBOARD =====
function renderDashboard() {
 const today = new Date();
 const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
 document.getElementById('dashboard-date').textContent =
 today.toLocaleDateString('pt-BR', opts);

 const dueCards = getDueCards();
 const newCards = state.cards.filter(c => c.repetition === 0);
 const learned = state.cards.filter(c => c.repetition > 2);

 document.getElementById('stat-due').textContent = dueCards.length;
 document.getElementById('stat-new').textContent = newCards.length;
 document.getElementById('stat-learned').textContent = learned.length;
 document.getElementById('stat-streak').textContent = state.stats.streak || 0;

 // Category review list
 const catDue = {};
 dueCards.forEach(c => { catDue[c.cat] = (catDue[c.cat] || 0) + 1; });
 const catList = document.getElementById('category-review-list');

 if (Object.keys(catDue).length === 0) {
    catList.innerHTML = '<div class="empty-state"><p>Nenhuma revisão pendente.</p></div>';
 } else {
 catList.innerHTML = Object.entries(catDue)
 .sort((a, b) => b[1] - a[1])
 .map(([cat, cnt]) => `
 <div class="cat-review-item">
 <span class="cat-review-name">${cat}</span>
 <span class="cat-review-count">${cnt} cards</span>
 </div>
 `).join('');
 }

 // Upcoming reviews
 const upcoming = state.cards
 .filter(c => !SM2.isDue(c))
 .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
 .slice(0, 6);

 const upList = document.getElementById('upcoming-list');
 if (upcoming.length === 0) {
 upList.innerHTML = '<p style="color:var(--gray-400);font-size:13px">Sem revisões futuras programadas.</p>';
 } else {
 upList.innerHTML = upcoming.map(c => {
 const daysUntil = Math.ceil((new Date(c.dueDate) - new Date()) / 86400000);
 const label = daysUntil === 1 ? 'amanhã' : `em ${daysUntil} dias`;
 return `
 <div class="upcoming-item">
 <span class="upcoming-question">${c.q}</span>
 <span class="upcoming-date">${label}</span>
 </div>
 `;
 }).join('');
 }

 // CTA
 const cta = document.getElementById('study-cta');
 const ctaMsg = document.getElementById('cta-message');
 if (dueCards.length > 0) {
 ctaMsg.textContent = `Você tem ${dueCards.length} card${dueCards.length > 1 ? 's' : ''} para revisar hoje!`;
 cta.style.display = 'flex';
 } else {
 cta.style.display = 'none';
 }
}

// ===== STUDY SESSION =====
function startStudySession(category = null) {
    let dueCards = getDueCards();
    
    state.studyQueue = category 
        ? dueCards.filter(c => c.cat === category)
        : dueCards;
    
    state.studyTotal = state.studyQueue.length;
    state.studyIndex = 0;

    const session = document.getElementById('study-session');
    const empty = document.getElementById('study-empty');

    if (state.studyQueue.length === 0) {
        session.style.display = 'none';
        empty.style.display = 'block';
        return;
    }

    session.style.display = 'block';
    empty.style.display = 'none';
    showCurrentCard();
}

function showCurrentCard() {
 if (state.studyIndex >= state.studyQueue.length) {
 finishStudy();
 return;
 }

 const card = state.studyQueue[state.studyIndex];
 const flashcard = document.getElementById('flashcard');

 // Reset flip
 flashcard.classList.remove('flipped');
 document.getElementById('rating-panel').style.display = 'none';
 document.getElementById('flip-btn').style.display = 'inline-flex';

 // Populate
 document.getElementById('card-category-tag').textContent = card.cat;
 document.getElementById('card-front-content').textContent = card.q;
 document.getElementById('card-back-content').textContent = card.a;
  document.getElementById('card-hint').textContent = card.hint ? `Dica: ${card.hint}` : '';
 document.getElementById('card-explanation').textContent = card.exp || '';

 // Progress
 const pct = (state.studyIndex / state.studyTotal) * 100;
 document.getElementById('study-progress-text').textContent =
 `${state.studyIndex} / ${state.studyTotal}`;
 document.getElementById('study-progress-fill').style.width = pct + '%';
}

function flipCard() {
 const flashcard = document.getElementById('flashcard');
 flashcard.classList.toggle('flipped');

 if (flashcard.classList.contains('flipped')) {
 document.getElementById('rating-panel').style.display = 'block';
 document.getElementById('flip-btn').style.display = 'none';
 }
}

function rateCard(rating) {
 const card = state.studyQueue[state.studyIndex];
 const updated = SM2.process(card, rating);

 // Update card in state
 const idx = state.cards.findIndex(c => c.id === card.id);
 if (idx !== -1) {
 Object.assign(state.cards[idx], updated);
 state.cards[idx].reviewCount = (state.cards[idx].reviewCount || 0) + 1;
 state.cards[idx].status = updated.repetition > 2 ? 'review' : 'learning';
 }

 // Update stats
 state.stats.totalReviews = (state.stats.totalReviews || 0) + 1;
 if (rating >= 2) state.stats.correctReviews = (state.stats.correctReviews || 0) + 1;

 const today = new Date().toISOString().split('T')[0];
 state.stats.daysStudied = state.stats.daysStudied || {};
 state.stats.daysStudied[today] = (state.stats.daysStudied[today] || 0) + 1;

 if (state.stats.lastStudied !== today) {
 const yesterday = SM2.addDays(new Date(), -1).toISOString().split('T')[0];
 if (state.stats.lastStudied === yesterday) {
 state.stats.streak = (state.stats.streak || 0) + 1;
 } else {
 state.stats.streak = 1;
 }
 state.stats.lastStudied = today;
 }

 Storage.saveCards(state.cards);
 Storage.saveStats(state.stats);

 // If "Again", re-queue card at end
 if (rating === 0) {
 state.studyQueue.push({ ...card, ...updated });
 state.studyTotal = state.studyQueue.length;
 }

 state.studyIndex++;
 showCurrentCard();
 updateDueBadge();
}

function finishStudy() {
 const session = document.getElementById('study-session');
 const empty = document.getElementById('study-empty');
 session.style.display = 'none';
 empty.style.display = 'block';

 document.getElementById('study-progress-fill').style.width = '100%';
 document.getElementById('study-progress-text').textContent =
 `${state.studyTotal} / ${state.studyTotal}`;

  showToast('Sessão concluída.', 'success');
 updateDueBadge();
}

// ===== BROWSE =====
function renderBrowse() {
    const filterCatEl = document.getElementById('filter-category');
    const cats = [...new Set(state.cards.map(c => c.cat))].sort();
    
    // A fonte da verdade é o estado global
    const currentCat = state.filterCategory; 

    filterCatEl.innerHTML = '<option value="">Todas categorias</option>' + 
        cats.map(c => `<option value="${c}" ${c === currentCat ? 'selected' : ''}>${c}</option>`).join('');
    
    // Garante que o valor do dropdown está sincronizado
    filterCatEl.value = currentCat; 

    let filtered = state.cards;

    if (state.filterCategory) {
        filtered = filtered.filter(c => c.cat === state.filterCategory);
    }

    if (state.filterSearch) {
        const q = state.filterSearch.toLowerCase();
        filtered = filtered.filter(c => 
            c.q.toLowerCase().includes(q) || 
            c.a.toLowerCase().includes(q) ||
            c.cat.toLowerCase().includes(q)
        );
    }

    const grid = document.getElementById('cards-grid');

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1">
                <div class="empty-state-icon">--</div>
                <h3>Nenhum card encontrado</h3>
                <p>Tente outro filtro ou crie um novo card.</p>
            </div>
        `;
        return;
    }

    const today = new Date().toISOString().split('T')[0];

    grid.innerHTML = filtered.map(card => {
        const isDue = card.dueDate <= today;
        const statusClass = card.repetition === 0 ? 'status-new' : 
                            (card.repetition <= 2 ? 'status-learning' : 'status-review');
        const statusLabel = card.repetition === 0 ? 'Novo' : 
                            (card.repetition <= 2 ? 'Aprendendo' : 'Revisão');
        const daysLeft = Math.ceil((new Date(card.dueDate) - new Date()) / 86400000);
        const dueLabel = isDue ? 'Para revisar' : 
                         daysLeft === 1 ? 'Amanhã' : `Em ${daysLeft} dias`;
        
        return `
        <div class="card-item">
            <div class="card-item-category">${card.cat}</div>
            <div class="card-item-front">${escapeHtml(card.q)}</div>
            <div class="card-item-back">${escapeHtml(card.a)}</div>
            <div class="card-item-meta">
                <span>
                    <span class="card-status-dot ${statusClass}"></span>
                    ${statusLabel} · ${dueLabel}
                </span>
                <div class="card-item-actions">
                    <button class="btn-icon" onclick="editCard('${card.id}')">Editar</button>
                    <button class="btn-icon delete" onclick="deleteCard('${card.id}')">Excluir</button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

function escapeHtml(str) {
 return str
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
}

// ===== CARD CRUD =====
function handleFormSubmit(e) {
 e.preventDefault();

 const id = document.getElementById('edit-card-id').value;
 const today = new Date().toISOString().split('T')[0];

 const data = {
 cat: document.getElementById('form-category').value,
 q: document.getElementById('form-front').value.trim(),
 a: document.getElementById('form-back').value.trim(),
 hint: document.getElementById('form-hint').value.trim(),
 exp: document.getElementById('form-explanation').value.trim()
 };

 if (!data.q || !data.a || !data.cat) {
 showToast('Preencha todos os campos obrigatórios.', 'error');
 return;
 }

 if (id) {
 // Edit
 const idx = state.cards.findIndex(c => c.id === id);
 if (idx !== -1) {
 Object.assign(state.cards[idx], data);
 showToast('Card atualizado!', 'success');
 }
 } else {
 // Create
 state.cards.push({
 id: generateId(),
 ...data,
 interval: 0,
 repetition: 0,
 easeFactor: 2.5,
 dueDate: today,
 createdAt: today,
 reviewCount: 0,
 status: 'new'
 });
 showToast('Card criado com sucesso!', 'success');
 }

 Storage.saveCards(state.cards);
 renderSidebar();
 updateDueBadge();
 showView('browse');
}

function resetForm() {
 document.getElementById('edit-card-id').value = '';
 document.getElementById('form-title').textContent = 'Criar Novo Card';
 document.getElementById('form-submit-btn').textContent = 'Salvar Card';
 document.getElementById('card-form').reset();
}

function editCard(id) {
 const card = state.cards.find(c => c.id === id);
 if (!card) return;

 showView('create');
 document.getElementById('form-title').textContent = 'Editar Card';
 document.getElementById('form-submit-btn').textContent = 'Atualizar Card';
 document.getElementById('edit-card-id').value = card.id;
 document.getElementById('form-category').value = card.cat;
 document.getElementById('form-front').value = card.q;
 document.getElementById('form-back').value = card.a;
 document.getElementById('form-hint').value = card.hint || '';
 document.getElementById('form-explanation').value = card.exp || '';
}

function deleteCard(id) {
 state.pendingDeleteId = id;
 document.getElementById('modal').style.display = 'flex';
}

function confirmDelete() {
 if (!state.pendingDeleteId) return;
 state.cards = state.cards.filter(c => c.id !== state.pendingDeleteId);
 Storage.saveCards(state.cards);
 document.getElementById('modal').style.display = 'none';
 state.pendingDeleteId = null;
 showToast('Card excluído.', 'success');
 renderBrowse();
 renderSidebar();
 updateDueBadge();
}

// ===== STATS VIEW =====
function renderStats() {
 const cards = state.cards;
 const stats = state.stats;

 document.getElementById('stats-total-cards').textContent = cards.length;
 document.getElementById('stats-total-reviews').textContent = stats.totalReviews || 0;

 const accuracy = stats.totalReviews > 0
 ? Math.round((stats.correctReviews / stats.totalReviews) * 100)
 : 0;
 document.getElementById('stats-accuracy').textContent = accuracy + '%';

 const daysStudied = Object.keys(stats.daysStudied || {}).length;
 document.getElementById('stats-days-studied').textContent = daysStudied;

 renderHeatmap();
 renderCategoryBars();
 renderRetentionChart();
}

function renderHeatmap() {
 const container = document.getElementById('activity-heatmap');
 const daysStudied = state.stats.daysStudied || {};
 const cells = [];

 for (let i = 89; i >= 0; i--) {
 const date = SM2.addDays(new Date(), -i).toISOString().split('T')[0];
 const count = daysStudied[date] || 0;
 const level = count === 0 ? 0 : count < 5 ? 1 : count < 10 ? 2 : count < 20 ? 3 : 4;
 cells.push(`<div class="heat-cell heat-${level}" title="${date}: ${count} revisões"></div>`);
 }

 container.innerHTML = cells.join('');
}

function renderCategoryBars() {
 const counts = getCategoryCounts();
 const max = Math.max(...Object.values(counts), 1);
 const container = document.getElementById('category-bars');

 container.innerHTML = Object.entries(counts)
 .sort((a, b) => b[1] - a[1])
 .map(([cat, count]) => {
 const pct = (count / max) * 100;
 const color = CATEGORY_COLORS[cat] || '#475569';
 return `
 <div class="cat-bar-item">
 <div class="cat-bar-label">
 <span class="cat-bar-name">${cat}</span>
 <span class="cat-bar-count">${count}</span>
 </div>
 <div class="cat-bar-track">
 <div class="cat-bar-fill" style="width:${pct}%;background:${color}"></div>
 </div>
 </div>
 `;
 }).join('');
}

function renderRetentionChart() {
 const container = document.getElementById('retention-chart');
 const new_ = state.cards.filter(c => c.repetition === 0).length;
 const learning = state.cards.filter(c => c.repetition > 0 && c.repetition <= 2).length;
 const mature = state.cards.filter(c => c.repetition > 2).length;
 const total = state.cards.length || 1;

 const items = [
 { label: 'Novos', count: new_, color: '#2563eb' },
 { label: 'Aprendendo', count: learning, color: '#d97706' },
 { label: 'Maduros', count: mature, color: '#16a34a' }
 ];

 container.innerHTML = items.map(item => {
 const pct = Math.round((item.count / total) * 100);
 return `
 <div class="retention-item">
 <span class="retention-label">${item.label}</span>
 <div class="retention-track">
 <div class="retention-fill" style="width:${pct}%;background:${item.color}">
 ${pct > 10 ? pct + '%' : ''}
 </div>
 </div>
 <span style="font-size:13px;color:var(--gray-500);min-width:32px;text-align:right">${item.count}</span>
 </div>
 `;
 }).join('');
}

// ===== TOAST =====
function showToast(message, type = '') {
 const toast = document.getElementById('toast');
 toast.textContent = message;
 toast.className = `toast ${type} show`;
 clearTimeout(toast._timeout);
 toast._timeout = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', e => {
 if (state.currentView !== 'study') return;

 const flashcard = document.getElementById('flashcard');
 const isFlipped = flashcard.classList.contains('flipped');

 if (e.code === 'Space' && !isFlipped) {
 e.preventDefault();
 flipCard();
 }

 if (isFlipped) {
 if (e.key === '1') rateCard(0);
 if (e.key === '2') rateCard(1);
 if (e.key === '3') rateCard(2);
 if (e.key === '4') rateCard(3);
 }
});

// ===== START =====
init();
