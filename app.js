'use strict';

const SUPABASE_URL = window.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';
const HAS_SUPABASE_CONFIG = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const ADMIN_EMAILS = (() => {
  const raw = window.ADMIN_EMAILS;
  if (Array.isArray(raw)) return raw.map(e => String(e || '').trim().toLowerCase()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return [];
})();

function clearPersistedAuthTokens() {
  try {
    Object.keys(localStorage)
      .filter(key => key.includes('auth-token') && key.startsWith('sb-'))
      .forEach(key => localStorage.removeItem(key));
  } catch {}
}

if (HAS_SUPABASE_CONFIG) {
  clearPersistedAuthTokens();
}

const supabaseClient = HAS_SUPABASE_CONFIG
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    })
  : null;

// ===== REVIEW SCHEDULING RULES =====
const SM2 = {
 // ratings: 0=Wrong, 1=Hard, 2=Medium, 3=Easy
 // fixed intervals requested by user:
 // - easy: 7 days
 // - medium: 3 days
 // - hard or wrong: 1 day
 INTERVAL_MAP: [1, 1, 3, 7],

 process(card, rating) {
 let { interval, repetition, easeFactor, dueDate } = card;

 interval = this.INTERVAL_MAP[rating] || 1;

 if (rating === 0) {
 repetition = 0;
 } else {
 repetition += 1;
 }

 // Keep easeFactor for backward compatibility with existing data structure.
 if (typeof easeFactor !== 'number' || Number.isNaN(easeFactor)) {
  easeFactor = 2.5;
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
 KEY_THEME: 'medcards_theme',

 getTheme() {
   try { return localStorage.getItem(this.KEY_THEME) || 'light'; }
   catch { return 'light'; }
 },

 saveTheme(theme) {
   try { localStorage.setItem(this.KEY_THEME, theme); }
   catch {}
 }
};

// ===== APP STATE =====
let state = {
 allCards: [], // All cards loaded from JSON
 cards: [], // Cards currently in use (after syncing with localStorage)
 stats: {},
 currentView: 'dashboard',
 studyFilterDiscipline: '',
 studyFilterTopic: '',
 studyQueue: [],
 studyIndex: 0,
 studyTotal: 0,
 selectedResult: '',
 selectedDifficulty: '',
 currentUser: null,
 authenticated: false,
 profiles: [],
 pendingDeleteId: null,
 filterDiscipline: '',
 filterCategory: '',
 filterSearch: ''
};

const USER_STATUS = {
 ACTIVE: 'active',
 BLOCKED: 'blocked',
 PENDING: 'pending'
};

const USER_ROLE = {
 USER: 'user',
 ADMIN: 'admin'
};

const BASIC_SCIENCE_DISCIPLINE = 'Ciências Básicas';
const BASIC_SCIENCE_TOPICS = [
  'Anatomia',
  'Fisiologia',
  'Farmacologia',
  'Patologia',
  'Microbiologia',
  'Imunologia',
  'Bioquímica',
  'Semiologia'
];

const KNOWN_DISCIPLINES = [
  'Anestesiologia',
  'Medicina Intensiva',
  'Cardiologia',
  'Ciências Básicas',
  'Cirurgia',
  'Clínica Médica',
  'Ginecologia e Obstetrícia',
  'Neurologia',
  'Ortopedia e Traumatologia',
  'Pediatria',
  'Pneumologia',
  'Psiquiatria'
];

const DISCIPLINE_COLORS = {
  'Anestesiologia': '#ea580c',
  'Medicina Intensiva': '#dc2626',
  'Cardiologia': '#1d4ed8',
  'Clínica Médica': '#2563eb',
  'Ciências Básicas': '#0f766e',
  'Pneumologia': '#0284c7',
  'Ortopedia e Traumatologia': '#b45309',
  'Fisiologia': '#7c3aed',
  'Anatomia': '#16a34a',
  'Farmacologia': '#0891b2',
  'Patologia': '#b91c1c',
  'Microbiologia': '#b45309',
  'Imunologia': '#0f766e',
  'Bioquímica': '#db2777',
  'Semiologia': '#4f46e5',
  'Neurologia': '#7e22ce',
  'Cirurgia': '#be123c',
  'Pediatria': '#0284c7',
  'Ginecologia e Obstetrícia': '#9d174d',
  'Psiquiatria': '#4338ca'
};

function inferDisciplineByContent(cat = '', q = '') {
  const text = `${cat} ${q}`.toLowerCase();

  if (/ciências básicas|anatom|fisiolog|farmacolog|patolog|microbiolog|imunolog|bioqu[ií]m|semiolog|absor[cç][aã]o|distribui[cç][aã]o|metabolismo|excre[cç][aã]o|meia-vida|cin[eéê]tica|cinetica|biodispon|depura[cç][aã]o|f[aá]rmaco/.test(text)) return BASIC_SCIENCE_DISCIPLINE;
  if (/fibrila|flutter|ablação|anticoag|cardiovers|apêndice atrial|wpw|frequência|ritmo|fa\\b/.test(text)) return 'Cardiologia';
  if (/sepse|choque|ventila|ressuscita|hemodin|uti|intensiv|terapia intensiva|lactato|swan-ganz|foco infecc|suporte renal|pics|medicina intensiva/.test(text)) return 'Medicina Intensiva';
  if (/cl[ií]nica geral/.test(text)) return 'Clínica Médica';
  if (/noradrenalina|vasopressina|dobutamina|receptores adren|vasopressor|inotrópico|farmacocin|efeitos adversos/.test(text)) return 'Farmacologia';
  if (/anestesi|via aére|pré-op|bloqueador neuromuscular/.test(text)) return 'Anestesiologia';
  if (/anatom/.test(text)) return 'Anatomia';
  if (/fisiolog/.test(text)) return 'Fisiologia';
  if (/bioqu[ií]m/.test(text)) return 'Bioquímica';
  if (/microbiolog/.test(text)) return 'Microbiologia';
  if (/imunolog/.test(text)) return 'Imunologia';
  if (/patolog/.test(text)) return 'Patologia';
  if (/semiolog/.test(text)) return 'Semiologia';
  if (/pediatria|vacina/.test(text)) return 'Pediatria';
  if (/neurolog|cushing/.test(text)) return 'Neurologia';
  if (/cirurg/.test(text)) return 'Cirurgia';
  if (/gineco|obstetr|gravidez|parto|gestante|gestação|obstetric/.test(text)) return 'Ginecologia e Obstetrícia';
  if (/pneumolog|sdra/.test(text)) return 'Pneumologia';
  if (/cl[ií]nica m[eé]dica|framingham|insufici[eê]ncia card[ií]aca/.test(text)) return 'Clínica Médica';
  return 'Clínica Médica'; // fallback genérico — nunca mostrar 'Outro'
}

function splitCategory(cat = '', q = '') {
  const text = (cat || '').trim();
  if (!text) return { discipline: 'Clínica Médica', topic: '' };

  const legacyBasicTopics = ['Absorção', 'Distribuição', 'Excreção', 'Metabolismo', 'Meia-vida e Cinética', 'Cinética'];
  if (legacyBasicTopics.includes(text)) {
    return { discipline: BASIC_SCIENCE_DISCIPLINE, topic: 'Fisiologia' };
  }

  const separators = [' - ', ' – ', ': '];
  for (const sep of separators) {
    if (text.includes(sep)) {
      const parts = text.split(sep);
      const first = (parts.shift() || '').trim();
      const topic = parts.join(sep).trim();
      if (BASIC_SCIENCE_TOPICS.includes(first)) {
        const normalizedTopic = first;
        return { discipline: BASIC_SCIENCE_DISCIPLINE, topic: normalizedTopic };
      }
      if (KNOWN_DISCIPLINES.includes(first)) {
        if (first === BASIC_SCIENCE_DISCIPLINE) {
          const normalizedTopic = topic && BASIC_SCIENCE_TOPICS.includes(topic) ? topic : (topic || '');
          return { discipline: BASIC_SCIENCE_DISCIPLINE, topic: normalizedTopic || BASIC_SCIENCE_DISCIPLINE };
        }
        return { discipline: first, topic: topic || first };
      }
      return { discipline: inferDisciplineByContent(text, q), topic: text };
    }
  }
  const inferred = inferDisciplineByContent(text, q);
  if (inferred === BASIC_SCIENCE_DISCIPLINE) {
    const normalizedTopic = BASIC_SCIENCE_TOPICS.find(t => text.toLowerCase().includes(t.toLowerCase()));
    return { discipline: BASIC_SCIENCE_DISCIPLINE, topic: normalizedTopic || text };
  }
  return { discipline: inferred, topic: text };
}

function getDiscipline(card) {
  return splitCategory(card.cat, card.q).discipline;
}

function getTopic(card) {
  return splitCategory(card.cat, card.q).topic || card.cat;
}

function getAnesthesiaModule(topic = '', question = '') {
  const text = `${topic} ${question}`.toLowerCase();
  if (/pré-?op|pre-?op|avaliaç|asa\b|jejum/.test(text)) return 'ME1';
  if (/farmacolog|bloqueador neuromuscular|succinilcolina|rocur[oô]nio|cisatrac[uú]rio|neostigmina/.test(text)) return 'ME2';
  if (/via[s]? a[ée]rea[s]?|intuba[cç][aã]o|ventila[cç][aã]o com m[aá]scara|laringoscop|rsi\b/.test(text)) return 'ME3';
  return '';
}

function getBrowseTopic(card) {
  const discipline = getDiscipline(card);
  const topic = getTopic(card);
  if (discipline !== 'Anestesiologia') return topic;
  return getAnesthesiaModule(topic, card.q) || topic;
}

function getAllBrowseTopics(selectedDiscipline = '') {
  const base = state.cards.filter(c => !selectedDiscipline || getDiscipline(c) === selectedDiscipline);
  const unique = [...new Set(base.map(c => getBrowseTopic(c)).filter(Boolean))];
  if (selectedDiscipline === 'Anestesiologia') return ['ME1', 'ME2', 'ME3'];
  return unique.sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function getDisciplineTopicOptions(discipline) {
  if (discipline === 'Anestesiologia') return ['ME1', 'ME2', 'ME3'];
  if (discipline === BASIC_SCIENCE_DISCIPLINE) {
    return BASIC_SCIENCE_TOPICS;
  }
  return [...new Set(
    state.cards
      .filter(c => getDiscipline(c) === discipline)
      .map(c => getTopic(c))
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function updateTopicSuggestions(selectedDiscipline = '') {
  const list = document.getElementById('form-topic-options');
  if (!list) return;
  const options = getDisciplineTopicOptions(selectedDiscipline);
  list.innerHTML = options.map(topic => `<option value="${escapeHtml(topic)}"></option>`).join('');
}

function buildCategory(discipline, topic) {
  const d = (discipline || '').trim();
  const t = (topic || '').trim();
  if (!d) return t || 'Outro';
  return t ? `${d} - ${t}` : d;
}

function renderStudyFilters() {
  const disciplineEl = document.getElementById('study-filter-discipline');
  const topicEl = document.getElementById('study-filter-topic');
  if (!disciplineEl || !topicEl) return;

  const disciplines = getAllDisciplines();
  disciplineEl.innerHTML = '<option value="">Todas disciplinas</option>' +
    disciplines.map(d => `<option value="${d}" ${d === state.studyFilterDiscipline ? 'selected' : ''}>${d}</option>`).join('');

  const topics = getAllBrowseTopics(state.studyFilterDiscipline);
  topicEl.innerHTML = '<option value="">Todos temas</option>' +
    topics.map(t => `<option value="${t}" ${t === state.studyFilterTopic ? 'selected' : ''}>${t}</option>`).join('');
}

function getDisciplineCounts() {
  const counts = {};
  state.cards.forEach(c => {
    const discipline = getDiscipline(c);
    counts[discipline] = (counts[discipline] || 0) + 1;
  });
  return counts;
}

function getAllDisciplines() {
  const EXCLUDE = ['Outro', 'Terapia Intensiva', 'Clínica Geral'];
  const fromCards = [...new Set(state.cards.map(c => getDiscipline(c)))].filter(d => !EXCLUDE.includes(d));
  return [...new Set([...KNOWN_DISCIPLINES, ...fromCards])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function populateDisciplineSelect(selectEl) {
  if (!selectEl) return;
  const options = getAllDisciplines();
  selectEl.innerHTML = '<option value="">Selecione uma disciplina...</option>' +
    options.map(d => `<option value="${d}">${d}</option>`).join('');
}

function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

function isBootstrapAdminEmail(email = '') {
  return ADMIN_EMAILS.includes(normalizeEmail(email));
}

function getErrorMessage(errorLike) {
  if (!errorLike) return 'falha inesperada.';
  if (typeof errorLike === 'string') return errorLike;
  if (typeof errorLike.message === 'string' && errorLike.message.trim()) return errorLike.message;
  if (typeof errorLike.error_description === 'string' && errorLike.error_description.trim()) return errorLike.error_description;
  if (typeof errorLike.details === 'string' && errorLike.details.trim()) return errorLike.details;
  try {
    return JSON.stringify(errorLike);
  } catch {
    return 'falha inesperada.';
  }
}

function applyAuthState(isAuthenticated) {
  const authScreen = document.getElementById('auth-screen');
  const app = document.getElementById('app');
  const authStatus = document.getElementById('auth-status');

  if (isAuthenticated) {
    authScreen.style.display = 'none';
    app.style.display = 'flex';
    updateSessionUI();
    renderAll();
    showView('dashboard');
  } else {
    state.currentUser = null;
    state.authenticated = false;
    authScreen.style.display = 'flex';
    app.style.display = 'none';
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    if (loginForm) loginForm.reset();
    if (registerForm) registerForm.reset();
    if (authStatus && !HAS_SUPABASE_CONFIG) {
      authStatus.textContent = 'Configure window.SUPABASE_URL e window.SUPABASE_ANON_KEY para usar autenticação real.';
    }
  }
}

function setAuthStatus(message = '') {
  const authStatus = document.getElementById('auth-status');
  if (authStatus) authStatus.textContent = message;
}

function updateSessionUI() {
  const usernameEl = document.getElementById('session-username');
  const roleEl = document.getElementById('session-role');
  const navAdminBtn = document.getElementById('nav-admin-btn');

  if (!state.currentUser) return;

  usernameEl.textContent = state.currentUser.full_name || state.currentUser.email || '-';
  roleEl.textContent = state.currentUser.role === USER_ROLE.ADMIN ? 'administrador' : 'usuário';
  navAdminBtn.style.display = state.currentUser.role === USER_ROLE.ADMIN ? 'flex' : 'none';
}

function isAdmin() {
  return !!state.currentUser && state.currentUser.role === USER_ROLE.ADMIN;
}

async function loadOrCreateProfile(authUser) {
  const fallbackName = (authUser.email || 'usuário').split('@')[0];
  const resolvedName = authUser.user_metadata?.full_name || fallbackName;
  const userEmail = authUser.email || '';
  const shouldBeBootstrapAdmin = isBootstrapAdminEmail(userEmail);

  const { data: existing, error: existingErr } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  if (existingErr) throw existingErr;

  if (existing) {
    const needsAdminPromotion = shouldBeBootstrapAdmin &&
      (existing.role !== USER_ROLE.ADMIN || existing.status !== USER_STATUS.ACTIVE);
    const needsSync = existing.email !== userEmail ||
      existing.full_name !== resolvedName ||
      needsAdminPromotion;

    if (needsSync) {
      const updates = {
        email: userEmail,
        full_name: resolvedName,
        updated_at: new Date().toISOString()
      };
      if (needsAdminPromotion) {
        updates.role = USER_ROLE.ADMIN;
        updates.status = USER_STATUS.ACTIVE;
      }

      const { error: syncErr } = await supabaseClient
        .from('profiles')
        .update(updates)
        .eq('id', authUser.id);
      if (syncErr) throw syncErr;
      return { ...existing, ...updates };
    }
    return existing;
  }

  const insertPayload = {
    id: authUser.id,
    email: userEmail,
    full_name: resolvedName,
    role: shouldBeBootstrapAdmin ? USER_ROLE.ADMIN : USER_ROLE.USER,
    status: shouldBeBootstrapAdmin ? USER_STATUS.ACTIVE : USER_STATUS.PENDING
  };
  const { error: insertErr } = await supabaseClient.from('profiles').insert(insertPayload);
  if (insertErr) throw insertErr;
  return insertPayload;
}

async function loadUserData() {
  const { data: cards, error: cardsErr } = await supabaseClient
    .from('cards')
    .select('*')
    .order('created_at', { ascending: true });

  if (cardsErr) throw cardsErr;

  if (!cards || cards.length === 0) {
    await seedCardsForCurrentUser();
    return loadUserData();
  }

  // Keep category taxonomy aligned with cards.json for existing cards.
  // This prevents legacy rows from staying under "Outro" after taxonomy updates.
  const sourceByQuestion = new Map(state.allCards.map(c => [c.q, c]));
  const categoryUpdates = cards
    .map(card => {
      const source = sourceByQuestion.get(card.q);
      if (!source || source.cat === card.cat) return null;
      return { id: card.id, cat: source.cat };
    })
    .filter(Boolean);

  if (categoryUpdates.length > 0) {
    const updateRequests = categoryUpdates.map(update =>
      supabaseClient
        .from('cards')
        .update({ cat: update.cat })
        .eq('id', update.id)
    );
    await Promise.all(updateRequests);
  }

  // Sync new cards from cards.json that user doesn't have yet
  const existingQuestions = new Set(cards.map(c => c.q));
  const newCards = state.allCards.filter(c => !existingQuestions.has(c.q));
  if (newCards.length > 0) {
    const today = new Date().toISOString().split('T')[0];
    const payload = newCards.map(c => ({
      cat: c.cat,
      q: c.q,
      a: c.a,
      hint: c.hint || '',
      exp: c.exp || '',
      interval: 0,
      repetition: 0,
      ease_factor: 2.5,
      due_date: today,
      review_count: 0,
      status: 'new'
    }));
    const { error: syncErr } = await supabaseClient.from('cards').insert(payload);
    if (!syncErr) {
      console.log(`Synced ${newCards.length} new cards from cards.json`);
      return loadUserData();
    }
  }

  state.cards = cards.map(c => ({
    id: c.id,
    cat: c.cat,
    q: c.q,
    a: c.a,
    hint: c.hint || '',
    exp: c.exp || '',
    interval: c.interval ?? 0,
    repetition: c.repetition ?? 0,
    easeFactor: c.ease_factor ?? 2.5,
    dueDate: c.due_date,
    createdAt: c.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
    reviewCount: c.review_count ?? 0,
    status: c.status || 'new'
  }));

  const { data: statsRow, error: statsErr } = await supabaseClient
    .from('user_stats')
    .select('*')
    .maybeSingle();

  if (statsErr) throw statsErr;

  if (!statsRow) {
    const statsDefaults = { totalReviews: 0, correctReviews: 0, daysStudied: {}, streak: 0, lastStudied: '' };
    state.stats = statsDefaults;
    await persistStats();
  } else {
    state.stats = {
      totalReviews: statsRow.total_reviews || 0,
      correctReviews: statsRow.correct_reviews || 0,
      daysStudied: statsRow.days_studied || {},
      streak: statsRow.streak || 0,
      lastStudied: statsRow.last_studied || ''
    };
  }
}

async function seedCardsForCurrentUser() {
  const today = new Date().toISOString().split('T')[0];
  const payload = state.allCards.map(c => ({
    cat: c.cat,
    q: c.q,
    a: c.a,
    hint: c.hint || '',
    exp: c.exp || '',
    interval: 0,
    repetition: 0,
    ease_factor: 2.5,
    due_date: today,
    review_count: 0,
    status: 'new'
  }));

  if (payload.length === 0) return;
  const { error } = await supabaseClient.from('cards').insert(payload);
  if (error) throw error;
}

async function persistCards() {
  if (!state.authenticated || !state.currentUser) return;
  const payload = state.cards.map(c => ({
    id: c.id,
    user_id: state.currentUser.id,
    cat: c.cat,
    q: c.q,
    a: c.a,
    hint: c.hint || '',
    exp: c.exp || '',
    interval: c.interval ?? 0,
    repetition: c.repetition ?? 0,
    ease_factor: c.easeFactor ?? 2.5,
    due_date: c.dueDate,
    created_at: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
    review_count: c.reviewCount ?? 0,
    status: c.status || 'new'
  }));

  const { error } = await supabaseClient.from('cards').upsert(payload);
  if (error) {
    console.error('Erro ao persistir cards:', error.message);
    showToast('Erro ao salvar cards no servidor.', 'error');
  }
}

async function persistStats() {
  if (!state.authenticated || !state.currentUser) return;
  const payload = {
    user_id: state.currentUser.id,
    total_reviews: state.stats.totalReviews || 0,
    correct_reviews: state.stats.correctReviews || 0,
    days_studied: state.stats.daysStudied || {},
    streak: state.stats.streak || 0,
    last_studied: state.stats.lastStudied || null
  };
  const { error } = await supabaseClient.from('user_stats').upsert(payload);
  if (error) {
    console.error('Erro ao persistir stats:', error.message);
    showToast('Erro ao salvar estatísticas no servidor.', 'error');
  }
}

async function hydrateAuthenticatedUser(authUser) {
  const profile = await loadOrCreateProfile(authUser);
  if (profile.status === USER_STATUS.BLOCKED) {
    await supabaseClient.auth.signOut();
    applyAuthState(false);
    const msg = 'Usuário bloqueado pelo administrador.';
    setAuthStatus(msg);
    showToast(msg, 'error');
    return false;
  }
  if (profile.status === USER_STATUS.PENDING) {
    await supabaseClient.auth.signOut();
    applyAuthState(false);
    const msg = 'Conta pendente de liberação do administrador.';
    setAuthStatus(msg);
    showToast(msg, 'error');
    return false;
  }

  state.currentUser = profile;
  state.authenticated = true;
  await loadUserData();
  updateStreak();
  await persistStats();
  applyAuthState(true);
  setAuthStatus('');
  return true;
}

async function initAuth() {
  if (!HAS_SUPABASE_CONFIG) {
    applyAuthState(false);
    return false;
  }

  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      console.error('Erro ao carregar sessão:', error.message);
      applyAuthState(false);
      return false;
    }

    const authUser = data.session?.user;
    if (!authUser) {
      applyAuthState(false);
      return false;
    }
    return hydrateAuthenticatedUser(authUser);
  } catch (authErr) {
    console.error('Erro na autenticação:', authErr);
    applyAuthState(false);
    const detail = getErrorMessage(authErr);
    setAuthStatus(`Erro ao autenticar: ${detail}`);
    showToast(`Erro ao autenticar: ${detail}`, 'error');
    return false;
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  if (!HAS_SUPABASE_CONFIG) {
    const msg = 'Configuração do Supabase ausente.';
    setAuthStatus(msg);
    showToast(msg, 'error');
    return;
  }

  const email = normalizeEmail(document.getElementById('login-email').value);
  const password = document.getElementById('login-password').value;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    const raw = error.message || 'Falha no login.';
    const friendly = /email not confirmed/i.test(raw)
      ? 'E-mail ainda não confirmado no Supabase. Confirme o e-mail ou desative confirmação obrigatória em Authentication > Providers > Email.'
      : raw;
    setAuthStatus(`Falha no login: ${friendly}`);
    showToast(friendly, 'error');
    return;
  }
  const ok = data?.user ? await hydrateAuthenticatedUser(data.user) : await initAuth();
  if (ok) showToast('Login realizado com sucesso.', 'success');
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  if (!HAS_SUPABASE_CONFIG) {
    showToast('Configuração do Supabase ausente.', 'error');
    return;
  }

  const fullName = document.getElementById('register-name').value.trim();
  const email = normalizeEmail(document.getElementById('register-email').value);
  const password = document.getElementById('register-password').value;
  const authStatus = document.getElementById('auth-status');

  // Guarantee registration flow does not reuse any current session.
  await supabaseClient.auth.signOut();

  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName }
    }
  });

  if (error) {
    showToast(error.message || 'Falha ao criar conta.', 'error');
    return;
  }

  if (authStatus) {
    authStatus.textContent = 'Conta criada. Aguarde liberação do administrador para acessar.';
  }

  // Keep user on auth screen; never auto-enter dashboard from sign-up.
  await supabaseClient.auth.signOut();
  showToast('Cadastro realizado com sucesso.', 'success');
  e.target.reset();
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  applyAuthState(false);
  showToast('Sessão encerrada.', 'success');
}

// ===== INIT =====
async function init() {
  initTheme();
  await loadAllCards();
  bindEvents();
  applyAuthState(false);
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

function generateId() {
 if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
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
 const loginForm = document.getElementById('login-form');
 if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);
 const registerForm = document.getElementById('register-form');
 if (registerForm) registerForm.addEventListener('submit', handleRegisterSubmit);
 const disciplineField = document.getElementById('form-discipline');
 if (disciplineField) {
  disciplineField.addEventListener('change', e => updateTopicSuggestions(e.target.value));
 }

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

 // Evaluation buttons (result + difficulty)
 document.querySelectorAll('.eval-btn').forEach(btn => {
   btn.addEventListener('click', () => handleEvalOptionClick(btn));
 });
 document.getElementById('back-to-question-btn').addEventListener('click', unflipCard);
 document.getElementById('submit-evaluation-btn').addEventListener('click', submitEvaluation);

 // Search & filter
 document.getElementById('search-input').addEventListener('input', e => {
 state.filterSearch = e.target.value;
 renderBrowse();
 });

 document.getElementById('filter-discipline').addEventListener('change', e => {
 state.filterDiscipline = e.target.value;
 state.filterCategory = '';
 renderBrowse();
 });

 document.getElementById('filter-category').addEventListener('change', e => {
 state.filterCategory = e.target.value;
 renderBrowse();
 });

 const studyDisciplineEl = document.getElementById('study-filter-discipline');
 const studyTopicEl = document.getElementById('study-filter-topic');
 if (studyDisciplineEl) {
  studyDisciplineEl.addEventListener('change', e => {
    state.studyFilterDiscipline = e.target.value;
    state.studyFilterTopic = '';
    renderStudyFilters();
    startStudySession(state.studyFilterDiscipline || null, state.studyFilterTopic || null);
  });
 }
 if (studyTopicEl) {
  studyTopicEl.addEventListener('change', e => {
    state.studyFilterTopic = e.target.value;
    startStudySession(state.studyFilterDiscipline || null, state.studyFilterTopic || null);
  });
 }

 // Card form
 document.getElementById('card-form').addEventListener('submit', handleFormSubmit);
 document.getElementById('cancel-form-btn').addEventListener('click', () => showView('browse'));

 // Modal
 document.getElementById('modal-cancel').addEventListener('click', () => {
 document.getElementById('modal').style.display = 'none';
 state.pendingDeleteId = null;
 });
 document.getElementById('modal-confirm').addEventListener('click', confirmDelete);

 const themeToggle = document.getElementById('theme-toggle');
 if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

 const logoutBtn = document.getElementById('logout-btn');
 if (logoutBtn) logoutBtn.addEventListener('click', logout);
  const quickLogoutBtn = document.getElementById('quick-logout-btn');
  if (quickLogoutBtn) quickLogoutBtn.addEventListener('click', logout);
}

function initTheme() {
  const savedTheme = Storage.getTheme();
  applyTheme(savedTheme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  Storage.saveTheme(next);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) icon.textContent = theme === 'dark' ? '☀' : '◐';
}

async function loadProfiles() {
  const { data, error } = await supabaseClient.from('profiles').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  state.profiles = data || [];
}

async function updateProfile(userId, changes) {
  const { error } = await supabaseClient.from('profiles').update(changes).eq('id', userId);
  if (error) throw error;
}

async function toggleUserStatus(userId) {
  if (!isAdmin()) return;
  const profile = state.profiles.find(u => u.id === userId);
  if (!profile) return;
  if (profile.id === state.currentUser.id) {
    showToast('Você não pode alterar seu próprio status.', 'error');
    return;
  }
  const nextStatus = profile.status === USER_STATUS.BLOCKED ? USER_STATUS.ACTIVE : USER_STATUS.BLOCKED;
  try {
    await updateProfile(userId, { status: nextStatus, updated_at: new Date().toISOString() });
    await renderAdmin();
    showToast(`Usuário ${nextStatus === USER_STATUS.ACTIVE ? 'liberado' : 'bloqueado'}.`, 'success');
  } catch (error) {
    showToast(`Falha ao atualizar usuário: ${error.message}`, 'error');
  }
}

async function approveUser(userId) {
  if (!isAdmin()) return;
  try {
    await updateProfile(userId, { status: USER_STATUS.ACTIVE, updated_at: new Date().toISOString() });
    await renderAdmin();
    showToast('Usuário liberado com sucesso.', 'success');
  } catch (error) {
    showToast(`Falha ao liberar usuário: ${error.message}`, 'error');
  }
}

async function toggleUserRole(userId) {
  if (!isAdmin()) return;
  const profile = state.profiles.find(u => u.id === userId);
  if (!profile) return;
  if (profile.id === state.currentUser.id) {
    showToast('Não é permitido alterar seu próprio perfil.', 'error');
    return;
  }
  const nextRole = profile.role === USER_ROLE.ADMIN ? USER_ROLE.USER : USER_ROLE.ADMIN;
  try {
    await updateProfile(userId, { role: nextRole, updated_at: new Date().toISOString() });
    await renderAdmin();
    showToast('Perfil atualizado.', 'success');
  } catch (error) {
    showToast(`Falha ao alterar perfil: ${error.message}`, 'error');
  }
}

async function sendPasswordReset(userId) {
  if (!isAdmin()) return;
  const user = state.profiles.find(p => p.id === userId);
  if (!user?.email) {
    showToast('Usuário sem e-mail válido.', 'error');
    return;
  }
  const { error } = await supabaseClient.auth.resetPasswordForEmail(user.email);
  if (error) {
    showToast(`Erro ao enviar recuperação: ${error.message}`, 'error');
    return;
  }
  showToast(`E-mail de recuperação enviado para ${user.email}.`, 'success');
}

async function renderAdmin() {
  const list = document.getElementById('admin-users-list');
  if (!list) return;

  if (!isAdmin()) {
    list.innerHTML = '<div class="empty-state"><p>Acesso restrito ao administrador.</p></div>';
    return;
  }

  try {
    await loadProfiles();
  } catch (error) {
    list.innerHTML = `<div class="empty-state"><p>Falha ao carregar usuários: ${escapeHtml(error.message)}</p></div>`;
    return;
  }

  const users = [...state.profiles].sort((a, b) => normalizeEmail(a.email).localeCompare(normalizeEmail(b.email), 'pt-BR'));
  list.innerHTML = users.map(user => {
    const isCurrent = user.id === state.currentUser.id;
    const lastLogin = user.last_login_at ? new Date(user.last_login_at).toLocaleString('pt-BR') : 'nunca';
    const displayName = user.full_name || user.email || user.id;
    const statusLabel = user.status === USER_STATUS.ACTIVE ? 'ativo' : (user.status === USER_STATUS.BLOCKED ? 'bloqueado' : 'pendente');
    return `
      <article class="admin-user-item">
        <div class="admin-user-top">
          <strong>${escapeHtml(displayName)} ${isCurrent ? '(você)' : ''}</strong>
          <div style="display:flex;gap:6px;">
            <span class="admin-badge role-${user.role === USER_ROLE.ADMIN ? 'admin' : 'user'}">${user.role === USER_ROLE.ADMIN ? 'admin' : 'usuário'}</span>
            <span class="admin-badge status-${user.status === USER_STATUS.ACTIVE ? 'active' : (user.status === USER_STATUS.BLOCKED ? 'blocked' : 'pending')}">${statusLabel}</span>
          </div>
        </div>
        <div class="admin-user-meta">${escapeHtml(user.email || '')} · Último login: ${lastLogin}</div>
        <div class="admin-user-actions">
          ${user.status === USER_STATUS.PENDING ? `<button class="btn-icon" onclick="approveUser('${user.id}')">Liberar</button>` : ''}
          <button class="btn-icon" onclick="toggleUserStatus('${user.id}')" ${isCurrent ? 'disabled' : ''}>${user.status === USER_STATUS.BLOCKED ? 'Desbloquear' : 'Bloquear'}</button>
          <button class="btn-icon" onclick="toggleUserRole('${user.id}')" ${isCurrent ? 'disabled' : ''}>${user.role === USER_ROLE.ADMIN ? 'Tornar usuário' : 'Tornar admin'}</button>
          <button class="btn-icon" onclick="sendPasswordReset('${user.id}')">Reset senha</button>
        </div>
      </article>
    `;
  }).join('');
}

// ===== VIEWS =====
function showView(viewId, params = {}) {
    if (!state.authenticated) return;
    if (viewId === 'admin' && !isAdmin()) {
      showToast('Acesso restrito ao administrador.', 'error');
      return;
    }

    state.currentView = viewId;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const viewEl = document.getElementById('view-' + viewId);
    if (viewEl) viewEl.classList.add('active');

    const navBtn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
    if (navBtn) navBtn.classList.add('active');

    if (viewId === 'dashboard') renderDashboard();
    if (viewId === 'study') {
      if (Object.prototype.hasOwnProperty.call(params, 'discipline')) {
        state.studyFilterDiscipline = params.discipline || '';
        state.studyFilterTopic = '';
      }
      if (Object.prototype.hasOwnProperty.call(params, 'topic')) {
        state.studyFilterTopic = params.topic || '';
      }
      renderStudyFilters();
      startStudySession(state.studyFilterDiscipline || null, state.studyFilterTopic || null);
    }
    if (viewId === 'browse') renderBrowse();
    if (viewId === 'stats') renderStats();
    if (viewId === 'create') resetForm();
    if (viewId === 'admin') renderAdmin();
}

// ===== RENDER ALL =====
function renderAll() {
 renderSidebar();
 updateDueBadge();
 renderDashboard();
}

// ===== SIDEBAR =====
function getGroupedCategories() {
    const grouped = {};
    state.cards.forEach(card => {
        const parts = card.cat.split(' - ');
        const subject = parts[0].trim();
        // If there's no ' - ', the subject is the category itself
        const category = parts.length > 1 ? parts.slice(1).join(' - ').trim() : subject;

        if (!grouped[subject]) {
            grouped[subject] = {};
        }
        if (!grouped[subject][category]) {
            grouped[subject][category] = 0;
        }
        grouped[subject][category]++;
    });
    return grouped;
}

function renderSidebar() {
    const list = document.getElementById('category-list');
    if (!list) return;

    const disciplines = getDisciplineCounts();
    list.innerHTML = '';

    Object.entries(disciplines)
      .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
      .forEach(([discipline, count]) => {
          const chip = document.createElement('div');
          chip.className = 'cat-chip';
          chip.innerHTML = `<span>${discipline}</span><span class="cat-chip-count">${count}</span>`;
          chip.addEventListener('click', () => {
              showView('study', { discipline });
          });
          list.appendChild(chip);
      });
}

function getCategoryCounts() {
  return getDisciplineCounts();
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

 // Discipline review list
 const catDue = {};
 dueCards.forEach(c => {
   const discipline = getDiscipline(c);
   catDue[discipline] = (catDue[discipline] || 0) + 1;
 });
 const catList = document.getElementById('category-review-list');

 if (Object.keys(catDue).length === 0) {
    catList.innerHTML = '<div class="empty-state"><p>Nenhuma revisão pendente.</p></div>';
 } else {
 catList.innerHTML = Object.entries(catDue)
 .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
 .map(([cat, cnt]) => `
 <div class="cat-review-item cat-review-clickable" data-discipline="${cat}" role="button" tabindex="0" aria-label="Estudar ${cat}">
 <span class="cat-review-name">${cat}</span>
 <span class="cat-review-count">${cnt} cards</span>
 </div>
 `).join('');

 catList.querySelectorAll('.cat-review-clickable').forEach(item => {
   item.addEventListener('click', () => {
     showView('study', { discipline: item.dataset.discipline });
   });
   item.addEventListener('keydown', e => {
     if (e.key === 'Enter' || e.key === ' ') {
       e.preventDefault();
       showView('study', { discipline: item.dataset.discipline });
     }
   });
 });
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
function startStudySession(discipline = null, topic = null) {
    let dueCards = getDueCards();
    if (discipline) {
      dueCards = dueCards.filter(c => getDiscipline(c) === discipline);
    }
    if (topic) {
      dueCards = dueCards.filter(c => getBrowseTopic(c) === topic);
    }
    state.studyQueue = dueCards;
    
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
 document.querySelector('.flashcard-container').classList.remove('answered');
 document.getElementById('rating-panel').style.display = 'none';
 document.getElementById('flip-btn').style.display = 'inline-flex';
 state.selectedResult = '';
 state.selectedDifficulty = '';
 updateEvaluationUI();

 // Populate
 const studyTag = getDiscipline(card) === 'Anestesiologia'
   ? `Anestesiologia - ${getBrowseTopic(card)}`
   : card.cat;
 document.getElementById('card-category-tag').textContent = studyTag;
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
 document.querySelector('.flashcard-container').classList.add('answered');
 document.getElementById('rating-panel').style.display = 'block';
 document.getElementById('flip-btn').style.display = 'none';
 }
}

function unflipCard() {
 const flashcard = document.getElementById('flashcard');
 if (!flashcard.classList.contains('flipped')) return;

 flashcard.classList.remove('flipped');
 document.querySelector('.flashcard-container').classList.remove('answered');
 document.getElementById('rating-panel').style.display = 'none';
 document.getElementById('flip-btn').style.display = 'inline-flex';
}

function handleEvalOptionClick(btn) {
  if (btn.dataset.result) {
    state.selectedResult = btn.dataset.result;
  }
  if (btn.dataset.difficulty) {
    state.selectedDifficulty = btn.dataset.difficulty;
  }
  updateEvaluationUI();
}

function updateEvaluationUI() {
  document.querySelectorAll('.eval-btn').forEach(btn => {
    const selectedResult = btn.dataset.result && btn.dataset.result === state.selectedResult;
    const selectedDifficulty = btn.dataset.difficulty && btn.dataset.difficulty === state.selectedDifficulty;
    btn.classList.toggle('selected', !!(selectedResult || selectedDifficulty));
  });

  const submitBtn = document.getElementById('submit-evaluation-btn');
  const canSubmit = !!state.selectedResult && !!state.selectedDifficulty;
  submitBtn.disabled = !canSubmit;
}

function mapEvaluationToRating() {
  if (state.selectedResult === 'wrong') return 0;
  if (state.selectedDifficulty === 'hard') return 1;
  if (state.selectedDifficulty === 'medium') return 2;
  return 3;
}

function submitEvaluation() {
  if (!state.selectedResult || !state.selectedDifficulty) {
    showToast('Selecione resultado e dificuldade.', 'error');
    return;
  }
  const rating = mapEvaluationToRating();
  rateCard(rating, state.selectedResult === 'correct');
}

function rateCard(rating, wasCorrect = null) {
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
 const isCorrect = typeof wasCorrect === 'boolean' ? wasCorrect : rating >= 2;
 if (isCorrect) state.stats.correctReviews = (state.stats.correctReviews || 0) + 1;

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

 void persistCards();
 void persistStats();

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
    const disciplineEl = document.getElementById('filter-discipline');
    const filterCatEl = document.getElementById('filter-category');
    const disciplines = getAllDisciplines();
    const currentDiscipline = state.filterDiscipline;
    const currentCat = state.filterCategory;

    disciplineEl.innerHTML = '<option value="">Todas disciplinas</option>' +
      disciplines.map(d => `<option value="${d}" ${d === currentDiscipline ? 'selected' : ''}>${d}</option>`).join('');
    disciplineEl.value = currentDiscipline;

    const topics = [...new Set(
      state.cards
        .filter(c => !currentDiscipline || getDiscipline(c) === currentDiscipline)
        .map(c => getBrowseTopic(c))
    )];
    const normalizedTopics = currentDiscipline === 'Anestesiologia'
      ? ['ME1', 'ME2', 'ME3']
      : topics.sort((a, b) => a.localeCompare(b, 'pt-BR'));

    filterCatEl.innerHTML = '<option value="">Todos temas</option>' +
      normalizedTopics.map(t => `<option value="${t}" ${t === currentCat ? 'selected' : ''}>${t}</option>`).join('');
    filterCatEl.value = currentCat;

    let filtered = state.cards;

    if (state.filterDiscipline) {
        filtered = filtered.filter(c => getDiscipline(c) === state.filterDiscipline);
    }

    if (state.filterCategory) {
        filtered = filtered.filter(c => getBrowseTopic(c) === state.filterCategory);
    }

    if (state.filterSearch) {
        const q = state.filterSearch.toLowerCase();
        filtered = filtered.filter(c => 
            c.q.toLowerCase().includes(q) || 
            c.a.toLowerCase().includes(q) ||
            c.cat.toLowerCase().includes(q) ||
            getDiscipline(c).toLowerCase().includes(q) ||
            getBrowseTopic(c).toLowerCase().includes(q)
        );
    }

    const grid = document.getElementById('cards-grid');
    grid.className = 'cards-grid browse-organized';

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
    const now = new Date();

    const sorted = [...filtered].sort((a, b) => {
      const disciplineCompare = getDiscipline(a).localeCompare(getDiscipline(b), 'pt-BR');
      if (disciplineCompare !== 0) return disciplineCompare;

      const topicCompare = getBrowseTopic(a).localeCompare(getBrowseTopic(b), 'pt-BR');
      if (topicCompare !== 0) return topicCompare;

      const dueCompare = (a.dueDate || '').localeCompare(b.dueDate || '');
      if (dueCompare !== 0) return dueCompare;

      return a.q.localeCompare(b.q, 'pt-BR');
    });

    const byDiscipline = sorted.reduce((acc, card) => {
      const discipline = getDiscipline(card);
      if (!acc[discipline]) acc[discipline] = [];
      acc[discipline].push(card);
      return acc;
    }, {});

    grid.innerHTML = Object.entries(byDiscipline).map(([discipline, cards]) => {
      const cardsHtml = cards.map(card => {
        const isDue = card.dueDate <= today;
        const statusClass = card.repetition === 0 ? 'status-new' :
                            (card.repetition <= 2 ? 'status-learning' : 'status-review');
        const statusLabel = card.repetition === 0 ? 'Novo' :
                            (card.repetition <= 2 ? 'Aprendendo' : 'Revisão');
        const daysLeft = Math.ceil((new Date(card.dueDate) - now) / 86400000);
        const dueLabel = isDue ? 'Para revisar' :
                         daysLeft === 1 ? 'Amanhã' : `Em ${daysLeft} dias`;

        const topic = getBrowseTopic(card);
        return `
          <div class="card-item">
              <div class="card-item-category">${escapeHtml(topic)}</div>
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

      return `
        <section class="browse-section">
          <div class="browse-section-header">
            <h3>${escapeHtml(discipline)}</h3>
            <span class="browse-section-count">${cards.length} cards</span>
          </div>
          <div class="browse-section-grid">
            ${cardsHtml}
          </div>
        </section>
      `;
    }).join('');
}

function escapeHtml(str) {
 return String(str)
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

 const discipline = document.getElementById('form-discipline').value.trim();
 const topic = document.getElementById('form-category').value.trim();
 const data = {
 cat: buildCategory(discipline, topic),
 q: document.getElementById('form-front').value.trim(),
 a: document.getElementById('form-back').value.trim(),
 hint: document.getElementById('form-hint').value.trim(),
 exp: document.getElementById('form-explanation').value.trim()
 };

 if (!data.q || !data.a || !discipline || !topic) {
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

 void persistCards();
 renderSidebar();
 updateDueBadge();
 showView('browse');
}

function resetForm() {
 document.getElementById('edit-card-id').value = '';
 document.getElementById('form-title').textContent = 'Criar Novo Card';
 document.getElementById('form-submit-btn').textContent = 'Salvar Card';
 document.getElementById('card-form').reset();
 populateDisciplineSelect(document.getElementById('form-discipline'));
 document.getElementById('form-discipline').value = '';
 updateTopicSuggestions('');
}

function editCard(id) {
 const card = state.cards.find(c => c.id === id);
 if (!card) return;

 showView('create');
 document.getElementById('form-title').textContent = 'Editar Card';
 document.getElementById('form-submit-btn').textContent = 'Atualizar Card';
 populateDisciplineSelect(document.getElementById('form-discipline'));

 const parts = splitCategory(card.cat, card.q);
 document.getElementById('edit-card-id').value = card.id;
 document.getElementById('form-discipline').value = parts.discipline;
 updateTopicSuggestions(parts.discipline);
 document.getElementById('form-category').value = getTopic(card);
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
 void persistCards();
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
 .sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
 .map(([cat, count]) => {
 const pct = (count / max) * 100;
 const color = DISCIPLINE_COLORS[cat] || '#475569';
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

 if (e.key === 'Escape' && isFlipped) {
 e.preventDefault();
 unflipCard();
 }

 if (isFlipped) {
 if (e.key === '1') { state.selectedResult = 'wrong'; state.selectedDifficulty = 'hard'; submitEvaluation(); }
 if (e.key === '2') { state.selectedResult = 'correct'; state.selectedDifficulty = 'hard'; submitEvaluation(); }
 if (e.key === '3') { state.selectedResult = 'correct'; state.selectedDifficulty = 'medium'; submitEvaluation(); }
 if (e.key === '4') { state.selectedResult = 'correct'; state.selectedDifficulty = 'easy'; submitEvaluation(); }
 }
});

// ===== START =====
init();
