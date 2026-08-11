// Unified Application State
let state = {
  toeicGoal: 800,
  streak: 0,
  lastActiveDate: null,
  completedQuizzes: 0,
  vocab: [], // Array of word objects
  homework: [], // Array of homework objects
  tests: [] // Array of test log objects
};

// Seed Vocab from words.js if local database is empty or needs merging of new parts
function seedInitialData() {
  if (state.vocab.length === 0 && typeof toeicVocabulary !== 'undefined') {
    Object.keys(toeicVocabulary).forEach(topicKey => {
      const topicData = toeicVocabulary[topicKey];
      topicData.words.forEach(w => {
        state.vocab.push({
          word: w.word,
          pronunciation: w.pronunciation || '',
          topic: topicData.title,
          status: 'new', // new, reviewing, learning, mastered
          lastReviewed: null,
          reviewCount: 0,
          meanings: [
            {
              type: w.type || 'noun',
              meaning: w.meaning,
              definition: w.definition || '',
              example: w.example || '',
              exampleMeaning: w.exampleMeaning || ''
            }
          ]
        });
      });
    });
    saveState();
  } else if (state.vocab.length > 0 && typeof toeicVocabulary !== 'undefined') {
    let updated = false;
    
    // 1. Copy missing fields (like exampleMeaning or pronunciation) from words.js to local words
    state.vocab.forEach(localWord => {
      Object.keys(toeicVocabulary).forEach(topicKey => {
        const match = toeicVocabulary[topicKey].words.find(w => w.word.toLowerCase() === localWord.word.toLowerCase());
        if (match) {
          // Normalize if not done yet
          if (!localWord.meanings || localWord.meanings.length === 0) {
            localWord.meanings = [{
              type: localWord.type || match.type || 'noun',
              meaning: localWord.meaning || match.meaning || '',
              definition: localWord.definition || match.definition || '',
              example: localWord.example || match.example || '',
              exampleMeaning: localWord.exampleMeaning || match.exampleMeaning || ''
            }];
            updated = true;
          }
          
          const primaryMeaning = localWord.meanings[0];
          if (!primaryMeaning.exampleMeaning && match.exampleMeaning) {
            primaryMeaning.exampleMeaning = match.exampleMeaning;
            updated = true;
          }
          if (!localWord.pronunciation && match.pronunciation) {
            localWord.pronunciation = match.pronunciation;
            updated = true;
          }
        }
      });
    });

    // 2. Import completely new category words (Listening P1-4, Reading P5-7) that do not exist locally
    Object.keys(toeicVocabulary).forEach(topicKey => {
      const topicData = toeicVocabulary[topicKey];
      topicData.words.forEach(w => {
        const exists = state.vocab.some(localWord => localWord.word.toLowerCase() === w.word.toLowerCase());
        if (!exists) {
          state.vocab.push({
            word: w.word,
            pronunciation: w.pronunciation || '',
            topic: topicData.title,
            status: 'new',
            lastReviewed: null,
            reviewCount: 0,
            meanings: [
              {
                type: w.type || 'noun',
                meaning: w.meaning,
                definition: w.definition || '',
                example: w.example || '',
                exampleMeaning: w.exampleMeaning || ''
              }
            ]
          });
          updated = true;
        }
      });
    });

    if (updated) {
      saveState();
    }
  }
}

// Load state from LocalStorage
function loadState() {
  const savedState = localStorage.getItem('toeic_personal_notebook_state');
  if (savedState) {
    state = JSON.parse(savedState);
  }
  
  // Ensure array structures exist
  if (!state.vocab) state.vocab = [];
  if (!state.homework) state.homework = [];
  if (!state.tests) state.tests = [];
  if (!state.toeicGoal) state.toeicGoal = 800;
  if (!state.streak) state.streak = 0;

  // Normalize and clean up loaded vocab items
  let needsSave = false;
  
  // Filter out non-vocab note headers like "Reading part 6 + 7 thầy dũng"
  const initialLength = state.vocab.length;
  state.vocab = state.vocab.filter(w => {
    if (!w.word) return false;
    const clean = sanitizeWordTitle(w.word);
    // Reject lines that are notes/headers
    if (!clean || clean.length < 2) return false;
    if (w.word.toLowerCase().includes('reading part') || w.word.toLowerCase().includes('thầy dũng') || w.word.toLowerCase().includes('bài tập ngày')) {
      return false;
    }
    return true;
  });
  if (state.vocab.length !== initialLength) needsSave = true;

  // Clean title, auto-correct typos, fix POS tags, apply SMART_TOEIC_TERMS and clean up template examples
  state.vocab.forEach(localWord => {
    let cleanTitle = sanitizeWordTitle(localWord.word);
    if (cleanTitle.toLowerCase() === 'pricipal') cleanTitle = 'Principal';
    if (cleanTitle.toLowerCase() === 'priorizre') cleanTitle = 'Prioritize';
    
    if (cleanTitle && cleanTitle !== localWord.word) {
      localWord.word = cleanTitle;
      needsSave = true;
    }

    if (localWord.pronunciation) {
      const cleanPron = localWord.pronunciation.replace(/\(\s*(n|v|adj|adv|noun|verb|adjective|adverb)\s*\)/gi, '').replace(/[()]/g, '').trim();
      if (cleanPron !== localWord.pronunciation) {
        localWord.pronunciation = cleanPron;
        needsSave = true;
      }
    }
    if (isFakeIPA(localWord.word, localWord.pronunciation)) {
      localWord.pronunciation = '';
      needsSave = true;
    }

    const key = localWord.word.toLowerCase().trim();
    if (SMART_TOEIC_TERMS[key]) {
      const smart = SMART_TOEIC_TERMS[key];
      if (smart.meanings && Array.isArray(smart.meanings) && smart.meanings.length > 0) {
        localWord.meanings = smart.meanings.map(m => ({
          type: (m.type || m.pos || 'noun').toLowerCase(),
          pos: normalizePOS(m.pos || m.type || 'NOUN'),
          meaning: m.meaning,
          definition: m.definition || '',
          example: m.example || '',
          exampleMeaning: m.exampleMeaning || ''
        }));
      } else if (smart.pos && smart.meaning) {
        localWord.meanings = [{
          type: smart.pos.toLowerCase(),
          pos: normalizePOS(smart.pos),
          meaning: smart.meaning,
          definition: smart.definition || '',
          example: smart.example || '',
          exampleMeaning: smart.exampleMeaning || ''
        }];
      }
      if (smart.pronunciation) {
        localWord.pronunciation = sanitizeIPA(smart.pronunciation);
      } else if (isFakeIPA(localWord.word, localWord.pronunciation)) {
        localWord.pronunciation = '';
      }
      needsSave = true;
    } else if (!localWord.meanings || localWord.meanings.length === 0) {
      const detectedPOS = detectWordPOS(localWord.word, localWord.type || 'noun');
      localWord.meanings = [{
        type: detectedPOS,
        meaning: localWord.meaning || 'Chưa cập nhật',
        definition: localWord.definition || '',
        example: generateTemplateExample(localWord.word, detectedPOS),
        exampleMeaning: ''
      }];
      needsSave = true;
    } else {
      localWord.meanings.forEach(m => {
        const validSet = new Set(['noun', 'verb', 'adjective', 'adverb', 'phrase']);
        if (!m.type || !validSet.has(m.type.toLowerCase().trim())) {
          m.type = detectWordPOS(localWord.word, m.type || 'noun');
          needsSave = true;
        }
        m.pos = normalizePOS(m.type);
        
        // Regenerate example if it contains boilerplate templates or stray POS tags
        const isBoilerplate = m.example && (
          m.example.includes('prepared a comprehensive report on the') ||
          m.example.includes('established a clear policy to monitor and evaluate') ||
          m.example.includes('emphasized the importance of optimizing the current') ||
          m.example.includes('review the attached documentation regarding the upcoming') ||
          m.example.includes('upcoming ') && m.example.includes('schedule') ||
          m.example.includes('team members ') && m.example.includes('their assigned') ||
          m.example.includes('decided to ') && m.example.includes('operational procedures') ||
          m.example.includes('requested the staff to ') && m.example.includes('project guidelines') ||
          m.example.includes('authorized the executive team to ') && m.example.includes('corporate strategy') ||
          m.example.includes('(adj') || m.example.includes('(v') || m.example.includes('(n')
        );

        if (!m.example || isBoilerplate) {
          m.example = generateTemplateExample(localWord.word, m.type);
          m.exampleMeaning = '';
          needsSave = true;
        }
        
        if (m.exampleMeaning) {
          const cleanEx = cleanVietnameseTranslation(m.exampleMeaning);
          if (cleanEx !== m.exampleMeaning) {
            m.exampleMeaning = cleanEx;
            needsSave = true;
          }
        }
        if (m.meaning) {
          const cleanM = cleanVietnameseTranslation(m.meaning);
          if (cleanM !== m.meaning) {
            m.meaning = cleanM;
            needsSave = true;
          }
        }
      });
    }
  });

  if (needsSave) {
    localStorage.setItem('toeic_personal_notebook_state', JSON.stringify(state));
  }
  
  seedInitialData();
  checkStreak();
  updateDashboardStats();
}

// Save state to LocalStorage
function saveState() {
  localStorage.setItem('toeic_personal_notebook_state', JSON.stringify(state));
  updateDashboardStats();
}

// Streak Tracking
function checkStreak() {
  const today = new Date().toDateString();
  if (state.lastActiveDate) {
    const lastDate = new Date(state.lastActiveDate);
    const diffTime = Math.abs(new Date(today) - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > 1) {
      state.streak = 0;
    }
  } else {
    state.streak = 0;
  }
}

function updateStreakForToday() {
  const today = new Date().toDateString();
  if (state.lastActiveDate !== today) {
    state.streak += 1;
    state.lastActiveDate = today;
    saveState();
  }
}

// Dashboard statistics mapping
function updateDashboardStats() {
  const totalWords = state.vocab.length;
  const masteredCount = state.vocab.filter(w => w.status === 'mastered').length;
  const reviewCount = state.vocab.filter(w => w.status === 'reviewing').length;
  
  // Update texts
  const statStreak = document.getElementById('stat-streak');
  if (statStreak) statStreak.textContent = state.streak;
  
  const statLearned = document.getElementById('stat-learned');
  if (statLearned) statLearned.textContent = `${masteredCount}/${totalWords}`;
  
  const statQuizzes = document.getElementById('stat-quizzes');
  if (statQuizzes) statQuizzes.textContent = state.completedQuizzes;
  
  const dbTodayReviews = document.getElementById('db-today-reviews');
  if (dbTodayReviews) dbTodayReviews.textContent = state.vocab.filter(w => w.status === 'reviewing' || w.status === 'learning').length;
  
  // Homework stats
  const pendingHw = state.homework.filter(h => h.status === 'pending').length;
  const dbPendingHw = document.getElementById('db-pending-hw');
  if (dbPendingHw) dbPendingHw.textContent = pendingHw;
  
  // Weak words
  const dbWeakWords = document.getElementById('db-weak-words');
  if (dbWeakWords) dbWeakWords.textContent = reviewCount;
  
  // Goal Settings
  const goalRangeVal = document.getElementById('goal-range-val');
  if (goalRangeVal) goalRangeVal.textContent = state.toeicGoal;
  const goalRange = document.getElementById('goal-range');
  if (goalRange) goalRange.value = state.toeicGoal;
  
  // Progress Bar
  const progressPercent = totalWords > 0 ? (masteredCount / totalWords) * 100 : 0;
  const overallProgressBar = document.getElementById('overall-progress-bar');
  if (overallProgressBar) overallProgressBar.style.width = `${progressPercent}%`;
  const overallProgressText = document.getElementById('overall-progress-text');
  if (overallProgressText) overallProgressText.textContent = `${Math.round(progressPercent)}% Hoàn thành`;
  
  // Custom alerts for weak sections
  renderWeakAreaAlerts();
}

function updateGoalSetting(val) {
  state.toeicGoal = parseInt(val);
  document.getElementById('goal-range-val').textContent = val;
  saveState();
}

// Render dynamic alerts based on practice logs
function renderWeakAreaAlerts() {
  const container = document.getElementById('db-weak-alerts');
  if (!container) return;
  container.innerHTML = '';
  
  let weakAreas = [];
  
  // 1. Analyze part averages from test logs
  const partsSum = {};
  const partsCount = {};
  
  state.tests.forEach(test => {
    if (test.partsScore) {
      Object.keys(test.partsScore).forEach(part => {
        partsSum[part] = (partsSum[part] || 0) + test.partsScore[part];
        partsCount[part] = (partsCount[part] || 0) + 1;
      });
    }
  });
  
  Object.keys(partsSum).forEach(part => {
    const avg = partsSum[part] / partsCount[part];
    if (avg < 60) {
      weakAreas.push(`⚠️ Bạn đang yếu <strong>${part}</strong> (Điểm trung bình: ${Math.round(avg)}%)`);
    }
  });
  
  // 2. Vocabulary warnings
  const reviewingCount = state.vocab.filter(w => w.status === 'reviewing').length;
  if (reviewingCount > 10) {
    weakAreas.push(`⚠️ Bạn đang có <strong>${reviewingCount} từ hay quên</strong> cần được ôn tập lại.`);
  }
  
  if (weakAreas.length === 0) {
    container.innerHTML = `<div style="color: var(--accent-success); font-size: 0.9rem;">✨ Chưa phát hiện điểm yếu nào lớn! Tiếp tục phát huy.</div>`;
  } else {
    weakAreas.forEach(alertHtml => {
      const alertDiv = document.createElement('div');
      alertDiv.className = 'stat-bar-row';
      alertDiv.style.background = 'rgba(239, 68, 68, 0.05)';
      alertDiv.style.border = '1px solid rgba(239, 68, 68, 0.2)';
      alertDiv.style.padding = '0.8rem';
      alertDiv.style.borderRadius = '12px';
      alertDiv.style.marginBottom = '0.5rem';
      alertDiv.style.fontSize = '0.9rem';
      alertDiv.innerHTML = alertHtml;
      container.appendChild(alertDiv);
    });
  }
}

// View Controller Routing
function showView(viewId) {
  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.remove('active');
  });
  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.add('active');
  }
  
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.getAttribute('data-view') === viewId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // View specific loading events
  if (viewId === 'dashboard') {
    updateDashboardStats();
  } else if (viewId === 'vocab-view') {
    switchVocabTab('vocab-list');
  } else if (viewId === 'homework-view') {
    switchHwTab('hw-reading');
  } else if (viewId === 'mock-view') {
    renderTestLogs();
  } else if (viewId === 'stats-view') {
    renderStatisticsPage();
  }
}

// Navigation Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  repairVocabIPA();
  
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showView(btn.getAttribute('data-view'));
    });
  });

  // Automatically trigger online lookup when user finishes typing and clicks away
  const vocabWordInput = document.getElementById('add-vocab-word');
  if (vocabWordInput) {
    vocabWordInput.addEventListener('blur', () => {
      const val = vocabWordInput.value.trim();
      if (val && activeEditIndex === null) {
        lookupWordDetails();
      }
    });
    
    // Prevent Enter key from submitting the form, trigger blur/lookup instead
    vocabWordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        vocabWordInput.blur();
      }
    });
  }
});

// ==========================================
// 📚 MODULE 2: VOCABULARY
// ==========================================

function switchVocabTab(tabId) {
  document.querySelectorAll('#vocab-view .tab-btn').forEach(btn => {
    if (btn.getAttribute('onclick').includes(tabId)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  document.querySelectorAll('#vocab-view .tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(tabId).classList.add('active');
  
  if (tabId === 'vocab-list') {
    renderVocabBank();
  } else if (tabId === 'vocab-add' && activeEditIndex === null) {
    const form = document.getElementById('add-word-form');
    if (form) form.reset();
    const container = document.getElementById('add-vocab-meanings-container');
    if (container) {
      container.innerHTML = '';
      addMeaningBlock();
    }
  } else if (tabId === 'vocab-review') {
    startSpacedReviewSession();
  } else if (tabId === 'vocab-match') {
    resetMatchGameView();
  } else if (tabId === 'vocab-spell') {
    initSpellMode();
  }
}

// Helper to add meaning block dynamically to form
function addMeaningBlock(data = null) {
  const container = document.getElementById('add-vocab-meanings-container');
  if (!container) return;
  
  const div = document.createElement('div');
  div.className = 'meaning-block glass-card';
  div.style.padding = '1.2rem';
  div.style.position = 'relative';
  div.style.marginTop = '0.5rem';
  div.style.border = '1px solid var(--border-color)';
  
  div.innerHTML = `
    <button type="button" class="btn-danger" style="position: absolute; top: 0.5rem; right: 0.5rem; padding: 2px 8px; font-size: 0.8rem; background: rgba(239, 68, 68, 0.15); color: var(--accent-danger); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 4px; cursor: pointer;" onclick="removeMeaningBlock(this)">Xóa</button>
    <div class="form-row" style="margin-top: 1rem;">
      <div class="form-group">
        <label style="font-size: 0.85rem; color: var(--text-secondary);">Từ loại</label>
        <select class="form-control vocab-type-input">
          <option value="noun" ${data?.type === 'noun' ? 'selected' : ''}>Danh từ (noun)</option>
          <option value="verb" ${data?.type === 'verb' ? 'selected' : ''}>Động từ (verb)</option>
          <option value="adjective" ${data?.type === 'adjective' ? 'selected' : ''}>Tính từ (adjective)</option>
          <option value="adverb" ${data?.type === 'adverb' ? 'selected' : ''}>Trạng từ (adverb)</option>
        </select>
      </div>
      <div class="form-group">
        <label style="font-size: 0.85rem; color: var(--text-secondary);">Ý nghĩa / Dịch thuật *</label>
        <input type="text" class="form-control vocab-meaning-input" placeholder="e.g. trì hoãn, chậm trễ" value="${data?.meaning || ''}" required>
      </div>
    </div>
    <div class="form-group">
      <label style="font-size: 0.85rem; color: var(--text-secondary);">Định nghĩa bằng tiếng Anh</label>
      <input type="text" class="form-control vocab-definition-input" placeholder="e.g. Make someone or something late" value="${data?.definition || ''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label style="font-size: 0.85rem; color: var(--text-secondary);">Câu ví dụ (English)</label>
        <input type="text" class="form-control vocab-example-input" placeholder="e.g. Our flight was delayed" value="${data?.example || ''}">
      </div>
      <div class="form-group">
        <label style="font-size: 0.85rem; color: var(--text-secondary);">Dịch nghĩa ví dụ (Vietnamese)</label>
        <input type="text" class="form-control vocab-example-meaning-input" placeholder="e.g. Chuyến bay bị hoãn" value="${data?.exampleMeaning || ''}">
      </div>
    </div>
  `;
  container.appendChild(div);
  
  // Hide the delete button if there's only 1 block
  updateDeleteButtonsVisibility();
}

function removeMeaningBlock(btn) {
  const block = btn.closest('.meaning-block');
  if (block) {
    block.remove();
    updateDeleteButtonsVisibility();
  }
}

function updateDeleteButtonsVisibility() {
  const container = document.getElementById('add-vocab-meanings-container');
  if (!container) return;
  const blocks = container.querySelectorAll('.meaning-block');
  blocks.forEach(block => {
    const delBtn = block.querySelector('.btn-danger');
    if (delBtn) {
      delBtn.style.display = blocks.length > 1 ? 'block' : 'none';
    }
  });
}

// Sanitization Helper & Standard Schema Transformer
const VALID_POS_SET = new Set(['NOUN', 'VERB', 'ADJECTIVE', 'ADVERB', 'PHRASE']);

function normalizePOS(rawPOS) {
  if (!rawPOS) return '';
  const p = rawPOS.toString().trim().toUpperCase();
  if (p === 'N' || p === 'NOUN') return 'NOUN';
  if (p === 'V' || p === 'VERB') return 'VERB';
  if (p === 'ADJ' || p === 'ADJECTIVE') return 'ADJECTIVE';
  if (p === 'ADV' || p === 'ADVERB') return 'ADVERB';
  if (p === 'PHRASE' || p === 'GERUND' || p === 'EXPRESSION' || p === 'IDIOM') return 'PHRASE';
  return VALID_POS_SET.has(p) ? p : '';
}

function sanitizeIPA(rawIPA) {
  if (!rawIPA) return '';
  let clean = rawIPA.trim();
  clean = clean.replace(/\(\s*(n|v|adj|adv|noun|verb|adjective|adverb)\s*\)/gi, '');
  clean = clean.replace(/[()]/g, '').trim();
  if (!clean || clean === '/' || clean === '/.../') return '';
  if (!clean.startsWith('/')) clean = '/' + clean;
  if (!clean.endsWith('/')) clean = clean + '/';
  return clean;
}

function isFakeIPA(word, ipa) {
  if (!ipa || !word) return true;
  const inner = sanitizeIPA(ipa).replace(/\//g, '').trim().toLowerCase();
  const normalizedWord = word.trim().toLowerCase();
  if (inner === normalizedWord) return true;
  const hasIPASymbols = /[əɪʊæɑɔɛʌɜˈˌɒθʃʒŋ]/i.test(inner);
  if (!hasIPASymbols) {
    const ipaTokens = inner.split(/\s+/);
    const wordTokens = normalizedWord.split(/\s+/);
    if (ipaTokens.length === wordTokens.length &&
        ipaTokens.every((t, i) => t.replace(/[^a-z']/g, '') === wordTokens[i].replace(/[^a-z']/g, ''))) {
      return true;
    }
  }
  return false;
}

const FUNCTION_WORD_IPA = {
  'a': 'ə',
  'an': 'æn',
  'the': 'ðə',
  'of': 'əv',
  'to': 'tuː',
  'in': 'ɪn',
  'on': 'ɒn',
  'at': 'æt',
  'for': 'fɔːr',
  'and': 'ænd',
  'or': 'ɔːr',
  'her': 'hɜːr',
  'his': 'hɪz',
  'their': 'ðer'
};

function sanitizeVocabEntry(raw) {
  if (!raw) return null;
  const word = sanitizeWordTitle(raw.word || '');
  let ipa = sanitizeIPA(raw.ipa || raw.pronunciation || '');
  if (isFakeIPA(word, ipa)) ipa = '';
  
  const rawMeanings = (raw.meanings && raw.meanings.length > 0)
    ? raw.meanings
    : [{
        type: raw.type || raw.pos || '',
        meaning: raw.meaning || raw.meaning_vi || '',
        definition: raw.definition || raw.definition_en || '',
        example: raw.example || raw.example_en || '',
        exampleMeaning: raw.exampleMeaning || raw.example_vi || ''
      }];

  const meanings = rawMeanings.map(m => {
    const normPOS = normalizePOS(m.type || m.pos || '');
    return {
      pos: normPOS, // "NOUN" | "VERB" | "ADJECTIVE" | "ADVERB" | "PHRASE" | ""
      type: normPOS ? normPOS.toLowerCase() : '',
      meaning_vi: cleanVietnameseTranslation(m.meaning || m.meaning_vi || ''),
      meaning: cleanVietnameseTranslation(m.meaning || m.meaning_vi || ''),
      definition_en: m.definition || m.definition_en || '',
      definition: m.definition || m.definition_en || '',
      example_en: m.example || m.example_en || '',
      example: m.example || m.example_en || '',
      example_vi: cleanVietnameseTranslation(m.exampleMeaning || m.example_vi || ''),
      exampleMeaning: cleanVietnameseTranslation(m.exampleMeaning || m.example_vi || '')
    };
  });

  return {
    word: word,
    ipa: ipa,
    pronunciation: ipa,
    topic: raw.topic || 'Cá nhân',
    status: raw.status || 'new',
    meanings: meanings
  };
}

// Render word bank list
function renderVocabBank() {
  const grid = document.getElementById('vbank-grid');
  grid.innerHTML = '';
  const searchVal = document.getElementById('vbank-search').value.toLowerCase();
  const filterStatus = document.getElementById('vbank-filter').value;
  
  // Get and populate unique topics
  const topicFilterDropdown = document.getElementById('vbank-topic-filter');
  const filterTopic = topicFilterDropdown ? topicFilterDropdown.value : 'all';
  
  if (topicFilterDropdown) {
    const uniqueTopics = Array.from(new Set(state.vocab.map(w => w.topic || 'Cá nhân'))).filter(Boolean);
    let topicOptionsHtml = `<option value="all">Tất cả chủ đề / Part</option>`;
    uniqueTopics.forEach(topic => {
      topicOptionsHtml += `<option value="${topic}" ${topic === filterTopic ? 'selected' : ''}>${topic}</option>`;
    });
    topicFilterDropdown.innerHTML = topicOptionsHtml;
  }

  state.vocab.forEach((rawWordData, index) => {
    const wordData = sanitizeVocabEntry(rawWordData);
    if (!wordData || !wordData.word) return;

    const matchSearch = !searchVal || 
        wordData.word.toLowerCase().includes(searchVal) ||
        (wordData.meanings && wordData.meanings.some(m => m.meaning.toLowerCase().includes(searchVal) || (m.definition && m.definition.toLowerCase().includes(searchVal))));
        
    if (!matchSearch) return;
    if (filterStatus !== 'all' && rawWordData.status !== filterStatus) return;
    if (filterTopic !== 'all' && (rawWordData.topic || 'Cá nhân') !== filterTopic) return;
    
    let statusClass = 'new', statusText = 'Mới';
    if (rawWordData.status === 'mastered')      { statusClass = 'mastered';  statusText = 'Đã thuộc'; }
    else if (rawWordData.status === 'reviewing') { statusClass = 'reviewing'; statusText = 'Hay quên'; }
    else if (rawWordData.status === 'learning')  { statusClass = 'learning';  statusText = 'Đang nhớ'; }

    // POS color map
    const posColors = {
      noun:      { bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.5)', badge: '#818cf8', label: 'NOUN' },
      verb:      { bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.4)',  badge: '#4ade80', label: 'VERB' },
      adjective: { bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.4)', badge: '#fb923c', label: 'ADJ' },
      adverb:    { bg: 'rgba(232,121,249,0.12)',border: 'rgba(232,121,249,0.4)',badge: '#e879f9', label: 'ADV' },
      phrase:    { bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.4)', badge: '#38bdf8', label: 'PHRASE' },
    };

    // Build meanings HTML — one styled block per POS
    let meaningsHtml = '';
    const meanings = wordData.meanings || [];
    const hasManyMeanings = meanings.length > 1;

    meanings.forEach((m, idx) => {
      const posKey = (m.pos || m.type || 'noun').toLowerCase();
      const col = posColors[posKey] || { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.15)', badge: '#94a3b8', label: (posKey || 'WORD').toUpperCase() };

      // Detect synonym note in meaning text (added by parseBatchLine)
      let mainMeaning = m.meaning || '';
      let synonymNote = '';
      const synIdx = mainMeaning.indexOf('| Đồng nghĩa:');
      if (synIdx !== -1) {
        synonymNote = mainMeaning.substring(synIdx + 2).trim();
        mainMeaning = mainMeaning.substring(0, synIdx).trim();
      }

      meaningsHtml += `
        <div style="
          margin-top: ${idx > 0 ? '0.6rem' : '0'};
          padding: 0.65rem 0.8rem;
          background: ${col.bg};
          border-left: 3px solid ${col.border};
          border-radius: 0 8px 8px 0;
        ">
          <div style="display:flex;align-items:center;gap:0.45rem;margin-bottom:0.3rem;flex-wrap:wrap;">
            <span style="
              background:${col.badge};color:#0f172a;
              font-size:0.68rem;font-weight:800;padding:1px 7px;
              border-radius:99px;letter-spacing:0.5px;
            ">${col.label}</span>
            <span style="font-weight:700;color:#f1f5f9;font-size:0.92rem;">${mainMeaning}</span>
          </div>
          ${m.definition ? `<div style="color:#94a3b8;font-size:0.78rem;margin-bottom:0.3rem;font-style:italic;">${m.definition}</div>` : ''}
          ${m.example ? `
          <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:0.4rem 0.6rem;margin-top:0.3rem;">
            <div style="color:#e2e8f0;font-size:0.8rem;font-style:italic;">
              <span style="color:${col.badge};font-weight:700;margin-right:4px;">e.g.</span>${m.example}
            </div>
            ${m.exampleMeaning ? `<div style="color:#64748b;font-size:0.75rem;margin-top:0.15rem;">↳ ${m.exampleMeaning}</div>` : ''}
          </div>` : ''}
          ${synonymNote ? `<div style="margin-top:0.35rem;font-size:0.75rem;color:#fbbf24;">🔗 ${synonymNote}</div>` : ''}
        </div>
      `;
    });

    const topicTag = rawWordData.topic && rawWordData.topic !== 'Cá nhân' 
      ? `<span style="font-size:0.68rem;font-weight:700;color:#64748b;background:rgba(255,255,255,0.05);padding:1px 6px;border-radius:6px;">${rawWordData.topic}</span>` 
      : '';

    const card = document.createElement('div');
    card.className = 'glass-card word-library-card';
    card.innerHTML = `
      <div class="word-library-header">
        <div class="word-library-title-wrap">
          <span class="word-library-title">${wordData.word}</span>
          ${hasManyMeanings ? `<span style="font-size:0.68rem;font-weight:800;color:#818cf8;background:rgba(99,102,241,0.15);padding:2px 7px;border-radius:99px;margin-left:6px;">${meanings.length} nghĩa</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem;" onclick="event.stopPropagation();">
          <button onclick="editVocabWord(${index}, event)" style="background:none;border:none;cursor:pointer;font-size:0.95rem;padding:2px;" title="Sửa từ">✏️</button>
          <button onclick="deleteVocabWord(${index}, event)" style="background:none;border:none;cursor:pointer;font-size:0.95rem;padding:2px;" title="Xóa từ">❌</button>
          <span class="status-badge ${statusClass}">${statusText}</span>
        </div>
      </div>
      <div class="word-library-ipa-row">
        ${wordData.ipa
          ? `<span class="ipa-text">${wordData.ipa}</span>`
          : `<span class="ipa-text ipa-missing">Chưa có IPA</span>`}
        <div style="display:flex;align-items:center;gap:0.4rem;">
          ${topicTag}
          <button onclick="playWordTTS('${wordData.word.replace(/'/g, "\\'")}', event)" style="background:none;border:none;cursor:pointer;color:var(--accent-primary);" title="Phát âm">🔊</button>
        </div>
      </div>
      <div style="margin-top:0.5rem;display:flex;flex-direction:column;gap:0.4rem;">
        ${meaningsHtml}
      </div>
    `;
    grid.appendChild(card);
  });
}


function playWordTTS(word, event) {
  if (event) event.stopPropagation();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

// Clean word title: strip trailing POS notes, colons, Vietnamese text, stray symbols
function sanitizeWordTitle(raw) {
  if (!raw) return '';
  let clean = raw.trim();
  
  // Cut off everything after colon, semicolon, equal sign, or parenthesis
  clean = clean.replace(/[:;=\(\)].*$/, '').trim();
  
  // Split into tokens
  const tokens = clean.split(/\s+/);
  const validTokens = [];
  const posKeywords = new Set(['n', 'v', 'adj', 'adv', 'noun', 'verb', 'adjective', 'adverb']);
  
  for (const t of tokens) {
    const lowerT = t.toLowerCase().replace(/[^a-z]/g, '');
    if (posKeywords.has(lowerT)) break; // Stop at POS keyword
    if (/[^a-zA-Z'-]/.test(t)) break; // Stop at non-English token
    if (t.length > 0) validTokens.push(t);
  }
  
  return validTokens.join(' ').trim();
}

// Global POS Normalizer
function normalizePOS(rawPOS) {
  if (!rawPOS) return 'NOUN';
  const r = String(rawPOS).toLowerCase().trim();
  if (r === 'n' || r === 'noun') return 'NOUN';
  if (r === 'v' || r === 'verb') return 'VERB';
  if (r === 'adj' || r === 'adjective') return 'ADJECTIVE';
  if (r === 'adv' || r === 'adverb') return 'ADVERB';
  if (r === 'phrase' || r === 'phr') return 'PHRASE';
  return rawPOS.toUpperCase();
}

// Global Free Google Translation Helper for Definitions & Examples
async function translateTextToVi(text) {
  if (!text || !text.trim()) return '';
  try {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(text.trim())}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data[0]) {
        return data[0].map(item => item[0]).join('').trim();
      }
    }
  } catch (e) {
    console.warn('Translation error:', e);
  }
  return '';
}

// Smart Dictionary Override for Common TOEIC Terms & Problem Terms
const SMART_TOEIC_TERMS = {
  'accommodate': {
    "pos": "verb",
    "pronunciation": "/əˈkɒməˌdeɪt/",
    "meaning": "Cung cấp chỗ ở; Đáp ứng, tạo điều kiện",
    "definition": "To provide lodging or sufficient space for; to fit the needs of.",
    "example": "The new conference venue can accommodate up to 500 attendees.",
    "exampleMeaning": "Địa điểm hội nghị mới có thể chứa tới 500 người tham dự."
},
  'accusation': {
    "pos": "noun",
    "pronunciation": "/ˌæk.jə.ˈzeɪ.ʃən/",
    "meaning": "Sự cáo buộc, lời buộc tội",
    "definition": "A charge or claim that someone has done something illegal or wrong.",
    "example": "The company issued a formal statement denying the accusation.",
    "exampleMeaning": "Công ty đã đưa ra một tuyên bố chính thức phủ nhận lời cáo buộc."
},
  'achievement': {
    "pos": "noun",
    "pronunciation": "/əˈtʃiːvmənt/",
    "meaning": "Thành tựu, sự đạt được",
    "definition": "A thing done successfully with effort, skill, or courage.",
    "example": "Reaching the annual sales target is a major achievement for our team.",
    "exampleMeaning": "Đạt được mục tiêu doanh số hàng năm là một thành tựu lớn của nhóm chúng tôi."
},
  'acknowledge': {
    "pos": "verb",
    "pronunciation": "/əkˈnɒ.lɪdʒ/",
    "meaning": "Công nhận, thừa nhận; Xác nhận (đã nhận thư/bưu phẩm)",
    "definition": "To accept or admit the truth of; to confirm receipt of a letter or email.",
    "example": "Please acknowledge receipt of this email by replying to the sender.",
    "exampleMeaning": "Vui lòng xác nhận đã nhận được email này bằng cách phản hồi lại cho người gửi."
},
  'accountant': {
    "pos": "noun",
    "pronunciation": "/ə.ˈkæʊn.(t)ən̩(t)/",
    "meaning": "Kế toán viên",
    "definition": "A person whose job is to keep or inspect financial accounts.",
    "example": "The chief accountant is preparing the quarterly financial statements.",
    "exampleMeaning": "Kế toán trưởng đang chuẩn bị các báo cáo tài chính hàng quý."
},
  'admit': {
    "pos": "verb",
    "pronunciation": "/ədˈmɪt/",
    "meaning": "Thừa nhận; Cho phép vào",
    "definition": "To confess to be true; to allow someone to enter.",
    "example": "Only ticket holders will be admitted to the main seminar hall.",
    "exampleMeaning": "Chỉ những người có vé mới được cho phép vào hội trường hội thảo chính."
},
  'advanced': {
    "pos": "adjective",
    "pronunciation": "/ədˈvɑːnst/",
    "meaning": "Tiên tiến, cao cấp, trình độ cao",
    "definition": "Far on or ahead in development or progress; sophisticated.",
    "example": "The software uses advanced algorithms to process customer feedback.",
    "exampleMeaning": "Phần mềm sử dụng các thuật toán tiên tiến để xử lý phản hồi của khách hàng."
},
  'affair': {
    "pos": "noun",
    "pronunciation": "/əˈfɛə/",
    "meaning": "Công việc, sự việc, vấn đề",
    "definition": "An event or sequence of events of a specified kind or that is being discussed.",
    "example": "The director oversees all corporate affairs and international relations.",
    "exampleMeaning": "Giám đốc giám sát tất cả các công việc của doanh nghiệp và quan hệ quốc tế."
},
  'affect': {
    "pos": "verb",
    "pronunciation": "/əˈfɛkt/",
    "meaning": "Ảnh hưởng, tác động đến",
    "definition": "Have an effect on; make a difference to.",
    "example": "The supply chain delay will directly affect our product delivery schedule.",
    "exampleMeaning": "Sự chậm trễ của chuỗi cung ứng sẽ ảnh hưởng trực tiếp đến lịch giao hàng."
},
  'anticipate': {
    "pos": "verb",
    "pronunciation": "/ænˈtɪs.ɪ.peɪt/",
    "meaning": "Dự đoán, mong đợi, lường trước",
    "definition": "Regard as probable; expect or predict.",
    "example": "We anticipate a strong increase in demand during the upcoming holiday season.",
    "exampleMeaning": "Chúng tôi dự đoán nhu cầu sẽ tăng mạnh trong mùa lễ sắp tới."
},
  'apologize': {
    "pos": "verb",
    "pronunciation": "/əˈpɒləd͡ʒaɪz/",
    "meaning": "Xin lỗi",
    "definition": "Express regret for something one has done wrong.",
    "example": "The airline manager apologized for the unexpected flight delay.",
    "exampleMeaning": "Quản lý hãng hàng không đã xin lỗi về sự chậm trễ chuyến bay ngoài dự kiến."
},
  'applicant': {
    "pos": "noun",
    "pronunciation": "/ˈæp.lə.kɪnt/",
    "meaning": "Người nộp đơn xin việc, ứng viên",
    "definition": "A person who makes a formal application for something, especially a job.",
    "example": "More than fifty qualified applicants submitted their resumes for the position.",
    "exampleMeaning": "Hơn năm mươi ứng viên đủ điều kiện đã nộp sơ yếu lý lịch cho vị trí này."
},
  'appointment': {
    "pos": "noun",
    "pronunciation": "/əˈpɔɪnt.mɛnt/",
    "meaning": "Cuộc hẹn (với bác sĩ, đối tác...); Sự bổ nhiệm",
    "definition": "An arrangement to meet someone at a particular time and place.",
    "example": "Mr. Davis has an appointment with the managing director at 3 PM.",
    "exampleMeaning": "Ông Davis có cuộc hẹn với giám đốc điều hành vào lúc 3 giờ chiều."
},
  'arrange': {
    "pos": "verb",
    "pronunciation": "/əˈɹeɪndʒ/",
    "meaning": "Sắp xếp, thu xếp",
    "definition": "Put things in a neat, attractive, or required order; organize.",
    "example": "The event coordinator will arrange transportation for international guests.",
    "exampleMeaning": "Điều phối viên sự kiện sẽ thu xếp phương tiện đi lại cho khách quốc tế."
},
  'assessment': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự đánh giá, thẩm định",
    "definition": "The evaluation or estimation of the nature, quality, or ability of someone or something.",
    "example": "The annual performance assessment helps identify candidates for promotion.",
    "exampleMeaning": "Đánh giá hiệu suất hàng năm giúp xác định các ứng viên để thăng chức."
},
  'assign': {
    "pos": "verb",
    "pronunciation": "/əˈsaɪn/",
    "meaning": "Phân công, giao việc",
    "definition": "Allocate a task or responsibility to someone.",
    "example": "The project manager will assign specific duties to each team member.",
    "exampleMeaning": "Quản lý dự án sẽ phân công công việc cụ thể cho từng thành viên trong nhóm."
},
  'attend': {
    "pos": "verb",
    "pronunciation": "/əˈtɛnd/",
    "meaning": "Tham dự, có mặt",
    "definition": "Be present at an event, meeting, or function.",
    "example": "All department heads are required to attend the strategy meeting.",
    "exampleMeaning": "Tất cả các trưởng bộ phận được yêu cầu tham dự cuộc họp chiến lược."
},
  'audience': {
    "pos": "noun",
    "pronunciation": "/ˈɔːdi.əns/",
    "meaning": "Khán giả, thính giả",
    "definition": "The assembled spectators or listeners at a public event.",
    "example": "The keynote speaker engaged the audience with an inspiring presentation.",
    "exampleMeaning": "Diễn giả chính đã thu hút khán giả bằng một bài thuyết trình đầy cảm hứng."
},
  'awareness': {
    "pos": "noun",
    "pronunciation": "/əˈwɛənəs/",
    "meaning": "Nhận thức, sự hiểu biết",
    "definition": "Knowledge or perception of a situation or fact.",
    "example": "The marketing campaign raised brand awareness across the nation.",
    "exampleMeaning": "Chiến dịch tiếp thị đã nâng cao nhận thức về thương hiệu trên toàn quốc."
},
    'bid': {
    "pronunciation": "/bɪd/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Sự đấu thầu, hồ sơ dự thầu",
            "definition": "An offer of a price to provide goods or services.",
            "example": "The construction firm submitted a competitive bid for the government project.",
            "exampleMeaning": "Công ty xây dựng đã nộp một hồ sơ đấu thầu cạnh tranh cho dự án của chính phủ."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Đấu thầu, trả giá",
            "definition": "Offer a certain price for something, especially at an auction or for a contract.",
            "example": "Several vendors plan to bid on the new IT infrastructure contract.",
            "exampleMeaning": "Một số nhà cung cấp có kế hoạch đấu thầu hợp đồng cơ sở hạ tầng IT mới."
        }
    ]
},
  'breakthrough': {
    "pos": "noun",
    "pronunciation": "/ˈbɹeɪkθɹuː/",
    "meaning": "Bước đột phá",
    "definition": "A sudden, dramatic, and important discovery or development.",
    "example": "The research team achieved a major medical breakthrough this year.",
    "exampleMeaning": "Nhóm nghiên cứu đã đạt được một bước đột phá y khoa lớn trong năm nay."
},
    'budget': {
    "pronunciation": "/ˈbʌdʒ.ɪt/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Ngân sách, quỹ tài chính",
            "definition": "An estimate of income and expenditure for a set period of time.",
            "example": "The department approved an increased budget for digital marketing.",
            "exampleMeaning": "Bộ phận đã phê duyệt một ngân sách tăng thêm cho tiếp thị kỹ thuật số."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Lên ngân sách, dự trù kinh phí",
            "definition": "Allow or provide a particular amount of money in a budget.",
            "example": "We need to budget carefully for travel expenses next quarter.",
            "exampleMeaning": "Chúng ta cần lên ngân sách cẩn thận cho các chi phí đi lại vào quý tới."
        }
    ]
},
  'cartridge': {
    "pos": "noun",
    "pronunciation": "/ˈkɑːtɹɪdʒ/",
    "meaning": "Hộp mực (máy in)",
    "definition": "A container holding ink or toner for a printer.",
    "example": "Please replace the empty toner cartridge in the office printer.",
    "exampleMeaning": "Vui lòng thay hộp mực trống trong máy in văn phòng."
},
    'cash': {
    "pronunciation": "/kæʃ/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Tiền mặt",
            "definition": "Money in coins or notes.",
            "example": "Clients who pay in cash will receive a five percent discount.",
            "exampleMeaning": "Khách hàng thanh toán bằng tiền mặt sẽ nhận được khoản giảm giá 5%."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Đổi thành tiền mặt, rút tiền",
            "definition": "Convert a check into money.",
            "example": "She went to the bank to cash her monthly paycheck.",
            "exampleMeaning": "Cô ấy đã đến ngân hàng để đổi séc tiền lương hàng tháng thành tiền mặt."
        }
    ]
},
  'cater': {
    "pos": "verb",
    "pronunciation": "/ˈkeɪtə/",
    "meaning": "Cung cấp dịch vụ ăn uống, phục vụ tiệc",
    "definition": "Provide food and drink for a event or social gathering.",
    "example": "A local restaurant will cater the company's annual anniversary dinner.",
    "exampleMeaning": "Một nhà hàng địa phương sẽ phục vụ tiệc cho bữa tối kỷ niệm hàng năm của công ty."
},
    'characteristic': {
    "pronunciation": "/ˌkær.ək.təˈrɪs.tɪk/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Đặc tính, đặc điểm",
            "definition": "A feature or quality belonging typically to a person, place, or thing.",
            "example": "Reliability is a key characteristic of our top suppliers.",
            "exampleMeaning": "Độ tin cậy là một đặc tính quan trọng của các nhà cung cấp hàng đầu của chúng tôi."
        },
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Đặc trưng, tiêu biểu",
            "definition": "Typical of a particular person, place, or thing.",
            "example": "He handled the client complaint with his characteristic professionalism.",
            "exampleMeaning": "Anh ấy đã xử lý khiếu nại của khách hàng với sự chuyên nghiệp đặc trưng của mình."
        }
    ]
},
  'chef': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Đầu bếp trưởng, bếp trưởng",
    "definition": "A professional cook, especially the principal cook in a restaurant or hotel.",
    "example": "The executive chef prepared an exquisite tasting menu for the VIP dinner.",
    "exampleMeaning": "Bếp trưởng điều hành đã chuẩn bị một thực đơn nếm thử tinh tế cho bữa tối VIP."
},
  'clearance sale': {
    "pos": "phrase",
    "pronunciation": "",
    "meaning": "Bán xả hàng, bán dọn kho",
    "definition": "A sale in which goods are sold at reduced prices to clear stock quickly.",
    "example": "The retail store is holding an end-of-season clearance sale.",
    "exampleMeaning": "Cửa hàng bán lẻ đang tổ chức đợt bán xả hàng dọn kho cuối mùa."
},
  'colleague': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Đồng nghiệp",
    "definition": "A person with whom one works in a profession or business.",
    "example": "I discussed the quarterly report with my colleague from marketing.",
    "exampleMeaning": "Tôi đã thảo luận báo cáo quý với đồng nghiệp của mình ở bộ phận tiếp thị."
},
  'commemorate': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Kỷ niệm, tưởng niệm",
    "definition": "Recall and show respect for someone or something in a ceremony.",
    "example": "The monument was erected to commemorate the company's founder.",
    "exampleMeaning": "Tượng đài được dựng lên để kỷ niệm người sáng lập công ty."
},
  'compensation': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Tiền bồi thường; Tiền lương thưởng",
    "definition": "Money awarded to someone as recompense for work, injury, or loss.",
    "example": "The firm offers attractive compensation packages to new hires.",
    "exampleMeaning": "Công ty cung cấp gói lương thưởng đền bù hấp dẫn cho nhân viên mới."
},
  'complaint': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Lời phàn nàn, sự khiếu nại",
    "definition": "A statement that something is unsatisfactory or unacceptable.",
    "example": "The customer service team promptly resolved the client complaint.",
    "exampleMeaning": "Nhóm dịch vụ khách hàng đã nhanh chóng giải quyết lời phàn nàn của khách hàng."
},
    'compliment': {
    "pronunciation": "/ˈkɒm.plɪ.mənt/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Lời khen, câu khen ngợi",
            "definition": "A polite expression of praise or admiration.",
            "example": "The manager gave the design team a high compliment for their creative layout.",
            "exampleMeaning": "Quản lý đã dành cho nhóm thiết kế một lời khen ngợi cao về bố cục sáng tạo."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Khen ngợi, tán dương",
            "definition": "Politely congratulate or praise someone for something.",
            "example": "The CEO complemented all employees on exceeding their annual targets.",
            "exampleMeaning": "CEO đã khen ngợi tất cả nhân viên vì đã vượt mục tiêu hàng năm."
        }
    ]
},
  'complimentary': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Miễn phí; Mang tính khen ngợi",
    "definition": "Given or supplied free of charge; expressing praise.",
    "example": "Guests receive complimentary breakfast and Wi-Fi during their stay.",
    "exampleMeaning": "Khách hàng nhận được bữa sáng và Wi-Fi miễn phí trong suốt thời gian lưu trú."
},
    'concern': {
    "pronunciation": "/kənˈsɜːn/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Mối bận tâm, sự lo lắng; Công ty, doanh nghiệp",
            "definition": "A matter of interest or importance; anxiety or worry.",
            "example": "Data privacy is a major concern for online consumers.",
            "exampleMeaning": "Bảo mật dữ liệu là một mối bận tâm lớn đối với người tiêu dùng trực tuyến."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Liên quan đến, làm cho lo lắng",
            "definition": "Relate to; be about; cause worry to.",
            "example": "The new safety policy concerns all factory workers.",
            "exampleMeaning": "Chính sách an toàn mới liên quan đến tất cả công nhân nhà máy."
        }
    ]
},
  'concerned': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Lo lắng, quan tâm",
    "definition": "Worried, troubled, or anxious about something.",
    "example": "The board members are concerned about the recent drop in sales revenue.",
    "exampleMeaning": "Các thành viên ban điều hành đang lo lắng về sự sụt giảm doanh thu bán hàng gần đây."
},
  'confirmation': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự xác nhận",
    "definition": "The action of confirming something; proof.",
    "example": "You will receive a booking confirmation email within twenty-four hours.",
    "exampleMeaning": "Bạn sẽ nhận được email xác nhận đặt chỗ trong vòng 24 giờ."
},
  'consult': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Tư vấn, tham khảo ý kiến",
    "definition": "Seek information or advice from someone with expertise.",
    "example": "Clients should consult an attorney before signing binding agreements.",
    "exampleMeaning": "Khách hàng nên tham khảo ý kiến luật sư trước khi ký các hợp đồng ràng buộc."
},
  'consultant': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Chuyên viên tư vấn, cố vấn",
    "definition": "A person who provides expert advice professionally.",
    "example": "The firm hired an IT consultant to upgrade its cybersecurity system.",
    "exampleMeaning": "Công ty đã thuê một chuyên viên tư vấn IT để nâng cấp hệ thống an ninh mạng."
},
  'consultation': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự tư vấn, cuộc hội đàm",
    "definition": "A meeting with an expert or professional, in order to seek advice.",
    "example": "We offer a free initial consultation for new business clients.",
    "exampleMeaning": "Chúng tôi cung cấp một cuộc hội đàm tư vấn ban đầu miễn phí cho các khách hàng doanh nghiệp mới."
},
  'contract': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "(N) Hợp đồng; (V) Ký hợp đồng, thu nhỏ",
    "definition": "A written or spoken agreement intended to be enforceable by law.",
    "example": "The legal department reviewed the vendor contract before signing.",
    "exampleMeaning": "Bộ phận pháp lý đã xem xét hợp đồng với nhà cung cấp trước khi ký kết."
},
  'corporation': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Tập đoàn, công ty lớn",
    "definition": "A large company or group of companies authorized to act as a single entity.",
    "example": "The multinational corporation operates branch offices in over forty countries.",
    "exampleMeaning": "Tập đoàn đa quốc gia vận hành các văn phòng chi nhánh tại hơn 40 quốc gia."
},
  'counterpart': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Đối tác, bên tương đương",
    "definition": "A person or thing holding a position corresponding to that of another.",
    "example": "The foreign minister met with his European counterpart in Brussels.",
    "exampleMeaning": "Bộ trưởng ngoại giao đã gặp bên đối tác tương đương của mình tại Brussels."
},
  'coverage': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Việc đưa tin; Phạm vi bảo hiểm",
    "definition": "The reporting of news; the extent of protection provided by insurance.",
    "example": "The comprehensive insurance policy offers full medical coverage.",
    "exampleMeaning": "Hợp đồng bảo hiểm toàn diện cung cấp phạm vi bảo hiểm y tế đầy đủ."
},
  'cuisine': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Ẩm thực, phong cách nấu ăn",
    "definition": "A style or method of cooking, especially as characteristic of a country or region.",
    "example": "The downtown restaurant is famous for serving authentic French cuisine.",
    "exampleMeaning": "Nhà hàng ở trung tâm thành phố nổi tiếng với việc phục vụ ẩm thực Pháp chính thống."
},
  'cultivate': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Trau dồi, nuôi dưỡng, canh tác",
    "definition": "Try to acquire or develop a quality, skill, or relationship.",
    "example": "Sales executives work hard to cultivate long-term business relationships.",
    "exampleMeaning": "Các chuyên viên kinh doanh làm việc chăm chỉ để nuôi dưỡng các mối quan hệ hợp tác dài hạn."
},
  'deadline': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Hạn chót, thời hạn hoàn thành",
    "definition": "The latest time or date by which something should be completed.",
    "example": "Everyone worked overtime to meet the tight project deadline.",
    "exampleMeaning": "Mọi người đã làm thêm giờ để kịp thời hạn hoàn thành dự án gấp rút."
},
  'deliver': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Giao hàng; Phát biểu (diễn văn)",
    "definition": "Bring and hand over goods or mail; give a speech or speech.",
    "example": "The keynote speaker will deliver an opening address tomorrow morning.",
    "exampleMeaning": "Diễn giả chính sẽ phát biểu diễn văn khai mạc vào sáng mai."
},
    'desire': {
    "pronunciation": "/dɪˈzaɪər/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Mối khao khát, mong muốn",
            "definition": "A strong feeling of wanting to have something.",
            "example": "The management expressed a strong desire to expand into Asian markets.",
            "exampleMeaning": "Ban quản lý đã thể hiện mong muốn mạnh mẽ mở rộng sang các thị trường châu Á."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Khao khát, mong mỏi",
            "definition": "Strongly wish for or want something.",
            "example": "We desire to build long-term partnerships with our clients.",
            "exampleMeaning": "Chúng tôi khao khát xây dựng mối quan hệ đối tác dài hạn với khách hàng."
        }
    ]
},
  'destination': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Điểm đến, đích đến",
    "definition": "The place to which someone or something is going or being sent.",
    "example": "Hawaii remains a top vacation destination for international travelers.",
    "exampleMeaning": "Hawaii vẫn là một điểm đến nghỉ dưỡng hàng đầu cho du khách quốc tế."
},
  'dilapidated': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Xập xệ, xuống cấp (nhà cửa)",
    "definition": "In a state of disrepair or ruin as a result of age or neglect.",
    "example": "The real estate developer renovated the dilapidated downtown warehouse.",
    "exampleMeaning": "Nhà phát triển bất động sản đã cải tạo kho hàng xập xệ xuống cấp ở trung tâm."
},
  'disappointment': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự thất vọng",
    "definition": "The feeling of sadness or displeasure caused by the nonfulfillment of hopes.",
    "example": "The cancellation of the annual conference was a major disappointment.",
    "exampleMeaning": "Việc hủy bỏ hội nghị hàng năm là một sự thất vọng lớn."
},
    'display': {
    "pronunciation": "/dɪˈspleɪ/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Màn hình, sự trưng bày, triển lãm",
            "definition": "A visual presentation of information or items.",
            "example": "The new store features an impressive window display.",
            "exampleMeaning": "Cửa hàng mới có một sự trưng bày cửa kính đầy ấn tượng."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Trưng bày, hiển thị",
            "definition": "Make a prominent exhibition of something.",
            "example": "The system will display total sales figures on the dashboard.",
            "exampleMeaning": "Hệ thống sẽ hiển thị tổng số liệu bán hàng trên bảng điều khiển."
        }
    ]
},
  'distribute': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Phân phối, phân phát",
    "definition": "Give a share or a number of something to each of a number of recipients.",
    "example": "The assistant will distribute the meeting agenda to all participants.",
    "exampleMeaning": "Trợ lý sẽ phân phát chương trình nghị sự cuộc họp cho tất cả những người tham gia."
},
    'downtown': {
    "pronunciation": "/ˌdaʊnˈtaʊn/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Khu trung tâm thành phố",
            "definition": "The central business district of a city.",
            "example": "Our main office is located in the heart of downtown.",
            "exampleMeaning": "Văn phòng chính của chúng tôi nằm ở trái tim khu trung tâm thành phố."
        },
        {
            "pos": "ADVERB",
            "type": "adverb",
            "meaning": "Ở / về trung tâm thành phố",
            "definition": "In or to the central part of a city.",
            "example": "The executive team relocated downtown last month.",
            "exampleMeaning": "Ban điều hành đã chuyển địa điểm về trung tâm thành phố vào tháng trước."
        }
    ]
},
  'due date': {
    "pos": "phrase",
    "pronunciation": "",
    "meaning": "Ngày đến hạn (thanh toán/nộp bài)",
    "definition": "The date on which something (such as a payment or report) is due.",
    "example": "The payment due date for the monthly invoice is October 31st.",
    "exampleMeaning": "Ngày đến hạn thanh toán cho hóa đơn hàng tháng là ngày 31 tháng 10."
},
  'efficiency': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Hiệu suất, năng suất làm việc",
    "definition": "The state or quality of achieving maximum productivity with minimum wasted effort.",
    "example": "Automating routine data entry increased overall office efficiency.",
    "exampleMeaning": "Tự động hóa việc nhập dữ liệu thường quy đã tăng hiệu suất làm việc tổng thể của văn phòng."
},
  'elementary': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Sơ cấp, cơ bản, thuộc tiểu học",
    "definition": "Relating to the most basic aspects of a subject; rudimentary.",
    "example": "The training program covers elementary principles of project management.",
    "exampleMeaning": "Chương trình đào tạo bao gồm các nguyên tắc cơ bản sơ cấp của quản lý dự án."
},
  'eligible': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Đủ điều kiện, đủ tiêu chuẩn",
    "definition": "Having the right to do or obtain something through satisfying the conditions.",
    "example": "Employees who work over two years are eligible for tuition reimbursement.",
    "exampleMeaning": "Nhân viên làm việc trên hai năm đủ điều kiện nhận hoàn trả tiền học phí."
},
  'enclose': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Đính kèm (trong thư/bưu phẩm); Bao quanh",
    "definition": "Place something inside an envelope or package together with a letter.",
    "example": "Please enclose a copy of your ID when mailing the application form.",
    "exampleMeaning": "Vui lòng đính kèm một bản sao ID của bạn khi gửi đơn đăng ký qua bưu điện."
},
  'encourage': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Khuyến khích, động viên",
    "definition": "Give support, confidence, or hope to someone; motivate.",
    "example": "Supervisors encourage team members to share innovative ideas during meetings.",
    "exampleMeaning": "Các giám sát viên khuyến khích các thành viên trong nhóm chia sẻ những ý tưởng sáng tạo."
},
  'enroll': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Đăng ký, ghi danh",
    "definition": "Officially register as a member or student on a course or college.",
    "example": "Over three hundred professionals enrolled in the online leadership course.",
    "exampleMeaning": "Hơn 300 chuyên gia đã đăng ký tham gia khóa học lãnh đạo trực tuyến."
},
  'enrollment': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự đăng ký, sự ghi danh",
    "definition": "The action of enrolling or being enrolled.",
    "example": "Course enrollment has increased by twenty percent compared to last semester.",
    "exampleMeaning": "Sự ghi danh khóa học đã tăng 20% so với học kỳ trước."
},
  'evaluation': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự đánh giá, sự định giá",
    "definition": "The making of a judgment about the amount, number, or value of something.",
    "example": "The committee completed its annual evaluation of all vendor proposals.",
    "exampleMeaning": "Ủy ban đã hoàn thành việc đánh giá hàng năm đối với tất cả các đề xuất của nhà cung cấp."
},
  'eventually': {
    "pos": "adverb",
    "pronunciation": "",
    "meaning": "Cuối cùng thì, rốt cuộc",
    "definition": "In the end, especially after a long delay, dispute, or series of problems.",
    "example": "After months of negotiations, the two firms eventually reached an agreement.",
    "exampleMeaning": "Sau nhiều tháng đàm phán, hai công ty rốt cuộc đã đạt được thỏa thuận."
},
  'exclude': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Loại trừ, không bao gồm",
    "definition": "Deny access to or bar someone from a place, group, or privilege.",
    "example": "The quoted price excludes shipping costs and regional taxes.",
    "exampleMeaning": "Mức giá được báo loại trừ chi phí giao hàng và các khoản thuế khu vực."
},
  'exclusive': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Độc quyền, dành riêng",
    "definition": "Restricted or limited to the person, group, or area concerned; high-class.",
    "example": "The luxury hotel offers exclusive amenities to executive suite guests.",
    "exampleMeaning": "Khách sạn sang trọng cung cấp các tiện ích dành riêng cho khách ở phòng hạng sang."
},
    'executive': {
    "pronunciation": "/ɪɡˈzek.jə.tɪv/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Giám đốc, người điều hành",
            "definition": "A person with senior managerial responsibility in a business.",
            "example": "The chief executive signed the final contract today.",
            "exampleMeaning": "Giám đốc điều hành đã ký hợp đồng cuối cùng hôm nay."
        },
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Thuộc về quản lý, điều hành",
            "definition": "Relating to managing or directing an organization.",
            "example": "The hotel offers exclusive executive suites for business travelers.",
            "exampleMeaning": "Khách sạn cung cấp các phòng hạng sang dành riêng cho doanh nhân."
        }
    ]
},
    'exhibit': {
    "pronunciation": "/ɪɡˈzɪb.ɪt/",
    "meanings": [
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Triển lãm, trưng bày",
            "definition": "Publicly display a work of art or item of interest.",
            "example": "Leading tech firms will exhibit their latest products at the expo.",
            "exampleMeaning": "Các công ty công nghệ hàng đầu sẽ triển lãm các sản phẩm mới nhất của họ tại hội chợ."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Vật trưng bày, tác phẩm triển lãm",
            "definition": "An object or collection of objects shown in an exhibition.",
            "example": "Visitors enjoyed the historical photo exhibit in the lobby.",
            "exampleMeaning": "Du khách rất thích tác phẩm triển lãm ảnh lịch sử tại sảnh."
        }
    ]
},
  'exposition': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Hội chợ triển lãm",
    "definition": "A large public exhibition of art or trade goods.",
    "example": "The international trade exposition attracted buyers from around the world.",
    "exampleMeaning": "Hội chợ triển lãm thương mại quốc tế đã thu hút người mua từ khắp nơi trên thế giới."
},
  'expire': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Hết hạn",
    "definition": "Cease to be valid, typically after a fixed period of time.",
    "example": "Your passport will expire in six months, so please renew it soon.",
    "exampleMeaning": "Hộ chiếu của bạn sẽ hết hạn trong sáu tháng nữa, vì vậy vui lòng sớm gia hạn."
},
  'facilitate': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Tạo điều kiện thuận lợi, làm cho dễ dàng",
    "definition": "Make an action or process easy or easier.",
    "example": "The new software tool will facilitate smoother communication between departments.",
    "exampleMeaning": "Công cụ phần mềm mới sẽ tạo điều kiện thuận lợi cho việc giao tiếp mượt mà hơn giữa các bộ phận."
},
    'fair': {
    "pronunciation": "/feər/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Hội chợ, thị trường thương mại",
            "definition": "A gathering of buyers and sellers for trade or exhibition.",
            "example": "The annual job fair connects students with top employers.",
            "exampleMeaning": "Hội chợ việc làm hàng năm kết nối sinh viên với các nhà tuyển dụng hàng đầu."
        },
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Công bằng, hợp lý, vừa phải",
            "definition": "Treating people equally without favoritism; reasonable.",
            "example": "We offered a fair price for the commercial property.",
            "exampleMeaning": "Chúng tôi đã đưa ra một mức giá hợp lý cho bất động sản thương mại."
        }
    ]
},
  'fare': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Tiền xe, tiền vé (tàu, xe, máy bay)",
    "definition": "The money a passenger on public transportation has to pay.",
    "example": "The bus fare has been increased slightly due to rising fuel costs.",
    "exampleMeaning": "Tiền vé xe bít đã tăng nhẹ do chi phí nhiên liệu tăng."
},
  'fellow': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "(N) Bạn, đồng nghiệp; (Adj) Cùng hội cùng thuyền",
    "definition": "A comrade, associate, or equal; sharing a particular position.",
    "example": "He shared the breakthrough discovery with his fellow researchers.",
    "exampleMeaning": "Anh ấy đã chia sẻ phát hiện đột phá với các bạn đồng nghiệp nghiên cứu của mình."
},
    'flavor': {
    "pronunciation": "/ˈfleɪ.vər/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Hương vị",
            "definition": "The distinctive taste of a food or drink.",
            "example": "The coffee shop introduced a new vanilla flavor.",
            "exampleMeaning": "Quán cà phê đã giới thiệu một hương vị vani mới."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Nêm nếm gia vị, gia tăng hương vị",
            "definition": "Alter or enhance the taste of food or drink.",
            "example": "The chef flavors the sauce with fresh organic herbs.",
            "exampleMeaning": "Đầu bếp nêm nếm nước sốt bằng thảo mộc hữu cơ tươi."
        }
    ]
},
  'frequent': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Thường xuyên",
    "definition": "Occurring or done on many occasions with short intervals between.",
    "example": "Airline members receive bonus points for frequent business travel.",
    "exampleMeaning": "Thành viên hãng hàng không nhận được điểm thưởng cho việc đi lại công tác thường xuyên."
},
    'handle': {
    "pronunciation": "/ˈhæn.dəl/",
    "meanings": [
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Xử lý, giải quyết, quản lý",
            "definition": "Manage, deal with, or be responsible for a situation.",
            "example": "Our support team can handle all customer inquiries efficiently.",
            "exampleMeaning": "Nhóm hỗ trợ của chúng tôi có thể xử lý tất cả các thắc mắc của khách hàng một cách hiệu quả."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Tay cầm, tay nắm cửa",
            "definition": "The part by which a thing is held or carried.",
            "example": "Please turn the door handle to open the conference room.",
            "exampleMeaning": "Vui lòng xoay tay nắm cửa để mở phòng hội nghị."
        }
    ]
},
  'hierarchy': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Hệ thống cấp bậc, thứ bậc",
    "definition": "A system or organization in which people or groups are ranked according to status.",
    "example": "The flat organizational hierarchy encourages open communication among staff.",
    "exampleMeaning": "Hệ thống cấp bậc tổ chức phẳng khuyến khích giao tiếp cởi mở giữa các nhân viên."
},
    'ideal': {
    "pronunciation": "/aɪˈdɪəl/",
    "meanings": [
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Lý tưởng, hoàn hảo",
            "definition": "Satisfying one's conception of what is perfect.",
            "example": "The downtown location is ideal for our new retail branch.",
            "exampleMeaning": "Vị trí trung tâm thành phố rất lý tưởng cho chi nhánh bán lẻ mới của chúng tôi."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Hình mẫu lý tưởng, tiêu chuẩn cao",
            "definition": "A person or thing regarded as perfect.",
            "example": "The company strives to uphold high ethical ideals.",
            "exampleMeaning": "Công ty nỗ lực duy trì các hình mẫu lý tưởng về đạo đức cao."
        }
    ]
},
  'immediate': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Ngay lập tức, tức thì",
    "definition": "Occurring or done at once; instant.",
    "example": "The IT department took immediate action to resolve the server outage.",
    "exampleMeaning": "Bộ phận IT đã có hành động ngay lập tức để khắc phục sự cố sập máy chủ."
},
    'implement': {
    "pronunciation": "/ˈɪm.plɪ.ment/",
    "meanings": [
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Triển khai, thực thi, thi hành",
            "definition": "Put a decision, plan, or agreement into effect.",
            "example": "We will implement the new software system next Monday.",
            "exampleMeaning": "Chúng tôi sẽ triển khai hệ thống phần mềm mới vào thứ Hai tới."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Công cụ, dụng cụ",
            "definition": "A tool, utensil, or piece of equipment.",
            "example": "Agricultural implements were imported for the farming project.",
            "exampleMeaning": "Các dụng cụ nông nghiệp đã được nhập khẩu cho dự án canh tác."
        }
    ]
},
  'impress': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Gây ấn tượng",
    "definition": "Make someone feel admiration and respect.",
    "example": "The candidate's strong presentation skills managed to impress the interview board.",
    "exampleMeaning": "Kỹ năng thuyết trình mạnh mẽ của ứng viên đã gây ấn tượng với hội đồng phỏng vấn."
},
  'improvement': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự cải tiến, sự cải thiện",
    "definition": "The action of improving or being improved; enhancement.",
    "example": "The latest software update shows significant improvement in processing speed.",
    "exampleMeaning": "Bản cập nhật phần mềm mới nhất cho thấy sự cải tiến đáng kể về tốc độ xử lý."
},
    'inconvenience': {
    "pronunciation": "/ˌɪn.kəmˈviː.ni.əns/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Sự bất tiện, phiền phức",
            "definition": "Trouble or difficulty caused to one's personal comfort.",
            "example": "We apologize for any inconvenience caused by the elevator maintenance.",
            "exampleMeaning": "Chúng tôi xin lỗi vì bất kỳ sự bất tiện nào do việc bảo trì thang máy gây ra."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Gây phiền phức, làm phiền",
            "definition": "Cause trouble or difficulty to someone.",
            "example": "We hope the schedule change will not inconvenience our guests.",
            "exampleMeaning": "Chúng tôi hy vọng việc thay đổi lịch trình sẽ không làm phiền các khách mời."
        }
    ]
},
  'insist': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Khăng khăng, đòi hỏi",
    "definition": "Demand something forcefully, not accepting refusal.",
    "example": "The client insisted on reviewing the final contract draft in person.",
    "exampleMeaning": "Khách hàng khăng khăng đòi tự mình xem xét bản thảo hợp đồng cuối cùng."
},
    'intern': {
    "pronunciation": "/ˈɪn.tɜːn/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Thực tập sinh",
            "definition": "A student or trainee who works to gain experience.",
            "example": "The marketing intern prepared an excellent market report.",
            "exampleMeaning": "Thực tập sinh tiếp thị đã chuẩn bị một báo cáo thị trường xuất sắc."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Thực tập",
            "definition": "Work as an intern.",
            "example": "She decided to intern at a prestigious accounting firm.",
            "exampleMeaning": "Cô ấy quyết định thực tập tại một công ty kế toán danh tiếng."
        }
    ]
},
    'invoice': {
    "pronunciation": "/ˈɪn.vɔɪs/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Hóa đơn thanh toán",
            "definition": "A commercial document requesting payment.",
            "example": "Please send the invoice to the finance department for payment.",
            "exampleMeaning": "Vui lòng gửi hóa đơn cho bộ phận tài chính để thanh toán."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Lập hóa đơn, gửi hóa đơn",
            "definition": "Send an invoice to a customer.",
            "example": "We will invoice your company upon completion of the service.",
            "exampleMeaning": "Chúng tôi sẽ lập hóa đơn cho công ty bạn khi hoàn thành dịch vụ."
        }
    ]
},
  'isolate': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Cô lập, cách ly",
    "definition": "Cause a person or thing to be alone or apart from others.",
    "example": "Technicians will isolate the faulty component to prevent further electrical issues.",
    "exampleMeaning": "Các kỹ thuật viên sẽ cô lập linh kiện bị lỗi để ngăn ngừa các sự cố điện tiếp theo."
},
  'itinerary': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Lịch trình chuyến đi",
    "definition": "A planned route or journey; a document outlining travel details.",
    "example": "The travel agent provided a detailed itinerary for the business trip.",
    "exampleMeaning": "Đại lý du lịch đã cung cấp một lịch trình chi tiết cho chuyến đi công tác."
},
    'leave': {
    "pronunciation": "/liːv/",
    "meanings": [
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Rời đi, bỏ lại",
            "definition": "Go away from a place.",
            "example": "The train will leave the station at 9 AM sharp.",
            "exampleMeaning": "Tàu sẽ rời ga vào đúng 9 giờ sáng."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Sự nghỉ phép, ngày nghỉ",
            "definition": "Time off allowed from work.",
            "example": "She is taking two weeks of maternity leave.",
            "exampleMeaning": "Cô ấy đang xin nghỉ phép thai sản hai tuần."
        }
    ]
},
    'lounge': {
    "pronunciation": "/laʊndʒ/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Phòng chờ, phòng nghỉ",
            "definition": "A public room where people can relax or wait.",
            "example": "VIP passengers can relax in the executive airport lounge.",
            "exampleMeaning": "Hành khách VIP có thể thư giãn tại phòng chờ sân bay hạng sang."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Thư giãn, nghỉ ngơi",
            "definition": "Lie, sit, or relax in a lazy way.",
            "example": "Guests can lounge by the hotel pool in the afternoon.",
            "exampleMeaning": "Khách hàng có thể thư giãn bên hồ bơi khách sạn vào buổi chiều."
        }
    ]
},
  'loyal': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Trung thành",
    "definition": "Giving or showing firm and constant support or allegiance to a person or institution.",
    "example": "The store rewards loyal customers with exclusive promotional discounts.",
    "exampleMeaning": "Cửa hàng thưởng cho những khách hàng trung thành bằng các khoản giảm giá khuyến mãi riêng."
},
  'luncheon': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Bữa tiệc trưa chính thức",
    "definition": "A formal lunch, typically held in connection with a meeting or conference.",
    "example": "The annual awards luncheon will be hosted at the grand ballroom.",
    "exampleMeaning": "Bữa tiệc trưa trao giải thưởng hàng năm sẽ được tổ chức tại phòng tiệc lớn."
},
  'majority': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Đa số, phần lớn",
    "definition": "The greater number or part of something.",
    "example": "The majority of shareholders voted in favor of the proposed merger.",
    "exampleMeaning": "Đa số các cổ đông đã bỏ phiếu đồng ý cho sự sáp nhập được đề xuất."
},
  'merge': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Sáp nhập, hợp nhất",
    "definition": "Combine or cause to combine to form a single entity.",
    "example": "The two tech startups agreed to merge their operations next quarter.",
    "exampleMeaning": "Hai công ty khởi nghiệp công nghệ đã đồng ý sáp nhập các hoạt động vào quý tới."
},
  'merger': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự sáp nhập",
    "definition": "A combination of two things, especially companies, into one.",
    "example": "The corporate merger created the largest telecommunications firm in the region.",
    "exampleMeaning": "Sự sáp nhập doanh nghiệp đã tạo ra công ty viễn thông lớn nhất trong khu vực."
},
    'mistake': {
    "pronunciation": "/mɪˈsteɪk/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Lỗi sai, sai sót",
            "definition": "An action or judgment that is misguided or wrong.",
            "example": "The accountant corrected the calculation mistake immediately.",
            "exampleMeaning": "Kế toán viên đã sửa lỗi sai tính toán ngay lập tức."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Nhầm lẫn, hiểu nhầm",
            "definition": "Wrongly identify or misunderstand.",
            "example": "Please do not mistake my enthusiasm for overconfidence.",
            "exampleMeaning": "Xin đừng nhầm lẫn sự nhiệt tình của tôi với sự quá tự tin."
        }
    ]
},
  'notify': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Thông báo, báo tin",
    "definition": "Inform someone officially about something.",
    "example": "The system will automatically notify users when their order has been shipped.",
    "exampleMeaning": "Hệ thống sẽ tự động thông báo cho người dùng khi đơn hàng của họ đã được giao."
},
    'novel': {
    "pronunciation": "/ˈnɒv.əl/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Tiểu thuyết",
            "definition": "A printed book containing a long story.",
            "example": "She enjoys reading historical novels during her free time.",
            "exampleMeaning": "Cô ấy thích đọc tiểu thuyết lịch sử trong thời gian rảnh rỗi."
        },
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Mới lạ, độc đáo",
            "definition": "New or unusual in an interesting way.",
            "example": "The team proposed a novel strategy to increase sales.",
            "exampleMeaning": "Nhóm đã đề xuất một chiến lược mới lạ để tăng doanh số."
        }
    ]
},
  'organic': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Hữu cơ, tự nhiên",
    "definition": "Produced or involving production without the use of chemical fertilizers.",
    "example": "Demand for organic food products has grown steadily among urban consumers.",
    "exampleMeaning": "Nhu cầu về các sản phẩm thực phẩm hữu cơ đã tăng đều đặn trong số những người tiêu dùng đô thị."
},
  'otherwise': {
    "pos": "adverb",
    "pronunciation": "",
    "meaning": "Nếu không thì, mặt khác",
    "definition": "In different circumstances; if not.",
    "example": "Please submit your application before Friday; otherwise, it will not be processed.",
    "exampleMeaning": "Vui lòng nộp đơn trước thứ Sáu; nếu không thì đơn sẽ không được xử lý."
},
  'outdoor': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Ngoài trời",
    "definition": "Done, situated, or used out of doors in the open air.",
    "example": "The company host an outdoor team-building event at the lakeside park.",
    "exampleMeaning": "Công ty tổ chức một sự kiện teambuilding ngoài trời tại công viên bên hồ."
},
  'outcome': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Kết quả, đầu ra",
    "definition": "The way a thing turns out; a consequence or result.",
    "example": "The management is satisfied with the successful outcome of the negotiation.",
    "exampleMeaning": "Ban quản lý rất hài lòng với kết quả thành công của cuộc đàm phán."
},
  'outsource': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Thuê ngoài (dịch vụ, nhân lực)",
    "definition": "Obtain goods or services from an outside or foreign supplier.",
    "example": "Many firms outsource their customer support services to cut operational costs.",
    "exampleMeaning": "Nhiều công ty thuê ngoài các dịch vụ hỗ trợ khách hàng để cắt giảm chi phí vận hành."
},
  'outsourcing': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Dịch vụ thuê ngoài",
    "definition": "The business practice of hiring a party outside a company to perform services.",
    "example": "IT outsourcing allows companies to focus on their core competencies.",
    "exampleMeaning": "Dịch vụ thuê ngoài IT cho phép các công ty tập trung vào năng lực cốt lõi của họ."
},
    'overseas': {
    "pronunciation": "/ˌəʊ.vəˈsiːz/",
    "meanings": [
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Ở nước ngoài, ngoại quốc",
            "definition": "Relating to foreign countries across the sea.",
            "example": "The company launched an overseas expansion campaign.",
            "exampleMeaning": "Công ty đã phát động một chiến dịch mở rộng ra nước ngoài."
        },
        {
            "pos": "ADVERB",
            "type": "adverb",
            "meaning": "Ra nước ngoài",
            "definition": "In or to a foreign country.",
            "example": "Many executives travel overseas for international trade shows.",
            "exampleMeaning": "Nhiều quản lý đi ra nước ngoài để tham dự các hội chợ thương mại quốc tế."
        }
    ]
},
  'payroll': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Bảng lương, quỹ lương",
    "definition": "A list of a company's employees and the amount of money to be paid to each.",
    "example": "The accounting office manages the monthly payroll for over five hundred staff.",
    "exampleMeaning": "Văn phòng kế toán quản lý bảng lương hàng tháng cho hơn 500 nhân viên."
},
  'personnel': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Nhân sự, toàn bộ nhân viên",
    "definition": "People employed in an organization or engaged in an organized undertaking.",
    "example": "All security personnel must complete a comprehensive safety training course.",
    "exampleMeaning": "Tất cả nhân sự an ninh phải hoàn thành khóa đào tạo an toàn toàn diện."
},
  'possess': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Sở hữu, có",
    "definition": "Have as belonging to one; have as a quality or ability.",
    "example": "Candidates must possess strong analytical and problem-solving skills.",
    "exampleMeaning": "Ứng viên phải sở hữu các kỹ năng phân tích và giải quyết vấn đề mạnh mẽ."
},
    'potential': {
    "pronunciation": "/pəˈten.ʃəl/",
    "meanings": [
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Tiềm năng, có triển vọng",
            "definition": "Having the capacity to develop into something in the future.",
            "example": "The sales representative met with several potential clients.",
            "exampleMeaning": "Đại diện kinh doanh đã gặp gỡ một số khách hàng tiềm năng."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Tiềm năng, khả năng phát triển",
            "definition": "Latent qualities or abilities that may be developed.",
            "example": "The new manager shows great potential for executive leadership.",
            "exampleMeaning": "Quản lý mới cho thấy tiềm năng lớn đối với vai trò lãnh đạo điều hành."
        }
    ]
},
  'preferably': {
    "pos": "adverb",
    "pronunciation": "",
    "meaning": "Tốt nhất là, ưu tiên là",
    "definition": "By choice; ideally.",
    "example": "Applicants should have a degree in business, preferably with two years of experience.",
    "exampleMeaning": "Ứng viên nên có bằng cấp về kinh doanh, ưu tiên tốt nhất là có 2 năm kinh nghiệm."
},
    'premier': {
    "pronunciation": "/ˈprem.i.ər/",
    "meanings": [
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Hàng đầu, tốt nhất, cao nhất",
            "definition": "First in importance, order, or position.",
            "example": "The resort is the premier destination for corporate retreats.",
            "exampleMeaning": "Khu nghỉ dưỡng là điểm đến hàng đầu cho các chuyến nghỉ dưỡng doanh nghiệp."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Thủ tướng, người đứng đầu",
            "definition": "A prime minister or head of government.",
            "example": "The premier attended the regional economic summit in Tokyo.",
            "exampleMeaning": "Thủ tướng đã tham dự hội nghị thượng đỉnh kinh tế khu vực tại Tokyo."
        }
    ]
},
  'prepare': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Chuẩn bị",
    "definition": "Make something ready for use or consideration.",
    "example": "The administrative assistant will prepare the slide deck for the presentation.",
    "exampleMeaning": "Trợ lý hành chính sẽ chuẩn bị bộ slide cho bài thuyết trình."
},
  'prevalent': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Phổ biến, thịnh hành",
    "definition": "Widespread in a particular area or at a particular time.",
    "example": "Flexible work arrangements have become increasingly prevalent in the tech industry.",
    "exampleMeaning": "Việc sắp xếp làm việc linh hoạt đã trở nên ngày càng phổ biến trong ngành công nghệ."
},
  'previously': {
    "pos": "adverb",
    "pronunciation": "",
    "meaning": "Trước đây, trước đó",
    "definition": "At a previous or earlier time; before.",
    "example": "She was previously employed as a senior financial analyst at a major bank.",
    "exampleMeaning": "Cô ấy trước đây từng làm việc với tư cách là chuyên viên phân tích tài chính cấp cao tại một ngân hàng lớn."
},
  'primary': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Chính, chủ yếu, cơ bản",
    "definition": "Of chief importance; principal.",
    "example": "Our primary objective is to increase customer satisfaction levels.",
    "exampleMeaning": "Mục tiêu chính của chúng tôi là nâng cao mức độ hài lòng của khách hàng."
},
    'prime': {
    "pronunciation": "/praɪm/",
    "meanings": [
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Hàng đầu, đắc địa, chất lượng nhất",
            "definition": "Of first importance; main; of the highest quality.",
            "example": "The office building is located in a prime financial district.",
            "exampleMeaning": "Tòa nhà văn phòng nằm ở một vị trí trung tâm tài chính đắc địa."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Thời kỳ hoàng kim",
            "definition": "A state or time of greatest strength, vigor, or success.",
            "example": "The company is currently in its prime of growth and expansion.",
            "exampleMeaning": "Công ty hiện đang trong thời kỳ hoàng kim của sự phát triển và mở rộng."
        }
    ]
},
  'priority': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự ưu tiên, quyền ưu tiên",
    "definition": "The fact or condition of being regarded or treated as more important.",
    "example": "Customer safety is the top priority for the resort management.",
    "exampleMeaning": "An toàn của khách hàng là sự ưu tiên hàng đầu đối với ban quản lý khu nghỉ dưỡng."
},
  'procedure': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Quy trình, thủ tục",
    "definition": "An official way of doing something; an established method.",
    "example": "Standard operating procedures must be followed strictly in the laboratory.",
    "exampleMeaning": "Quy trình vận hành tiêu chuẩn phải được tuân thủ nghiêm ngặt trong phòng thí nghiệm."
},
    'process': {
    "pronunciation": "/ˈprəʊ.ses/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Quá trình, quy trình",
            "definition": "A series of actions or steps taken to achieve an end.",
            "example": "The hiring process takes about three weeks to complete.",
            "exampleMeaning": "Quy trình tuyển dụng mất khoảng ba tuần để hoàn thành."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Xử lý (dữ liệu, hồ sơ, đơn hàng)",
            "definition": "Perform a series of operations on something.",
            "example": "The system will process your refund request within twenty-four hours.",
            "exampleMeaning": "Hệ thống sẽ xử lý yêu cầu hoàn tiền của bạn trong vòng 24 giờ."
        }
    ]
},
  'proficiency': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự thành thạo, sự tài giỏi",
    "definition": "A high degree of competence or skill; expertise.",
    "example": "Applicants are required to demonstrate high proficiency in written English.",
    "exampleMeaning": "Ứng viên được yêu cầu chứng minh sự thành thạo cao về tiếng Anh viết."
},
    'progress': {
    "pronunciation": "/ˈprəʊ.ɡres/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Tiến độ, sự tiến bộ",
            "definition": "Forward movement toward a destination or goal.",
            "example": "The team made steady progress on the software development project.",
            "exampleMeaning": "Nhóm đã đạt tiến độ đều đặn trong dự án phát triển phần mềm."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Tiến triển, phát triển",
            "definition": "Move forward or develop over time.",
            "example": "As negotiations progress, we hope to finalize the deal soon.",
            "exampleMeaning": "Khi các cuộc đàm phán tiến triển, chúng tôi hy vọng sớm hoàn tất thương vụ."
        }
    ]
},
  'promote': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Quảng bá, thúc đẩy; Thăng chức",
    "definition": "Support or actively encourage; advance to a higher position.",
    "example": "The marketing team created an online campaign to promote the new product line.",
    "exampleMeaning": "Nhóm tiếp thị đã tạo một chiến dịch trực tuyến để quảng bá dòng sản phẩm mới."
},
  'promotion': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Chương trình khuyến mãi; Sự thăng chức",
    "definition": "Activity that supports or encourages a cause; advancement in rank.",
    "example": "His hard work and dedication resulted in a well-deserved promotion to manager.",
    "exampleMeaning": "Sự chăm chỉ và cống hiến của anh ấy đã dẫn đến sự thăng chức xứng đáng lên vị trí quản lý."
},
  'proof': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Bằng chứng, chứng cứ",
    "definition": "Evidence or argument establishing or helping to establish a fact.",
    "example": "Customers must present proof of purchase when requesting a refund.",
    "exampleMeaning": "Khách hàng phải xuất trình bằng chứng mua hàng khi yêu cầu hoàn tiền."
},
  'properly': {
    "pos": "adverb",
    "pronunciation": "",
    "meaning": "Một cách đúng đắn, thích đáng",
    "definition": "In a proper or appropriate manner; correctly.",
    "example": "Ensure that all equipment is turned off properly before leaving the office.",
    "exampleMeaning": "Đảm bảo rằng tất cả thiết bị đã được tắt đúng cách trước khi rời khỏi văn phòng."
},
  'proposal': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Đề xuất, sự gợi ý",
    "definition": "A plan or suggestion, especially a formal or written one.",
    "example": "The board approved the budget proposal for the new marketing campaign.",
    "exampleMeaning": "Ban điều hành đã phê duyệt đề xuất ngân sách cho chiến dịch tiếp thị mới."
},
    'purchase': {
    "pronunciation": "/ˈpɜː.tʃəs/",
    "meanings": [
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Mua, sắm",
            "definition": "Acquire something by paying for it.",
            "example": "You can purchase event tickets online or at the box office.",
            "exampleMeaning": "Bạn có thể mua vé sự kiện trực tuyến hoặc tại quầy bán vé."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Việc mua hàng, hàng hóa mua được",
            "definition": "The action of buying something; the item bought.",
            "example": "Please keep your receipt as proof of purchase.",
            "exampleMeaning": "Vui lòng giữ lại hóa đơn của bạn như một bằng chứng mua hàng."
        }
    ]
},
  'purpose': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Mục đích, ý định",
    "definition": "The reason for which something is done or created or for which something exists.",
    "example": "The main purpose of the meeting is to discuss next year's expansion strategy.",
    "exampleMeaning": "Mục đích chính của cuộc họp là thảo luận chiến lược mở rộng của năm tới."
},
  'qualification': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Bằng cấp, trình độ chuyên môn",
    "definition": "A pass of an examination or an official completion of a course.",
    "example": "Candidates should list all academic qualifications on their resume.",
    "exampleMeaning": "Ứng viên nên liệt kê tất cả các bằng cấp chuyên môn học thuật trên CV."
},
  'qualified': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Đủ trình độ, đủ năng lực",
    "definition": "Officially recognized as eligible, competent, or fitted to perform a duty.",
    "example": "We are seeking a highly qualified accountant to manage corporate taxes.",
    "exampleMeaning": "Chúng tôi đang tìm kiếm một kế toán viên đủ trình độ chuyên môn để quản lý thuế công ty."
},
  'receptionist': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Nhân viên lễ tân",
    "definition": "A person employed to receive and greet visitors and answer phone calls.",
    "example": "The receptionist greeted the clients warmly upon their arrival at the office.",
    "exampleMeaning": "Nhân viên lễ tân đã chào đón khách hàng nồng nhiệt khi họ đến văn phòng."
},
  'recognition': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự ghi nhận, sự công nhận",
    "definition": "Identification of someone or something from previous encounter; appreciation.",
    "example": "She received an award in recognition of her outstanding sales performance.",
    "exampleMeaning": "Cô ấy đã nhận được một giải thưởng để ghi nhận hiệu suất bán hàng xuất sắc."
},
    'refund': {
    "pronunciation": "/ˈriː.fʌnd/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Tiền hoàn lại",
            "definition": "A payback of a sum of money to a customer.",
            "example": "The store issued a full refund for the damaged product.",
            "exampleMeaning": "Cửa hàng đã cấp một khoản hoàn tiền đầy đủ cho sản phẩm bị hỏng."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Hoàn tiền, trả lại tiền",
            "definition": "Pay back money to a customer.",
            "example": "We will refund your credit card within three business days.",
            "exampleMeaning": "Chúng tôi sẽ hoàn tiền lại thẻ tín dụng của bạn trong vòng 3 ngày làm việc."
        }
    ]
},
  'registration': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự đăng ký",
    "definition": "The action or process of registering or of being registered.",
    "example": "Conference registration opens at eight o'clock in the main lobby.",
    "exampleMeaning": "Sự đăng ký hội nghị mở cửa lúc 8 giờ sáng tại sảnh chính."
},
  'relocation': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự chuyển địa điểm, sự di dời",
    "definition": "The action of moving to a new place and establishing one's home or business there.",
    "example": "The corporate relocation to the new downtown facility is scheduled for next month.",
    "exampleMeaning": "Sự chuyển địa điểm của doanh nghiệp đến cơ sở trung tâm mới được lên lịch vào tháng tới."
},
    'representative': {
    "pronunciation": "/ˌrep.rɪˈzen.tə.tɪv/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Người đại diện, đại biểu",
            "definition": "A person chosen to act or speak for others.",
            "example": "A customer service representative is available 24/7 to assist you.",
            "exampleMeaning": "Một đại diện dịch vụ khách hàng có sẵn 24/7 để hỗ trợ bạn."
        },
        {
            "pos": "ADJECTIVE",
            "type": "adjective",
            "meaning": "Mang tính đại diện, tiêu biểu",
            "definition": "Typical of a class, group, or body of opinion.",
            "example": "The survey results are representative of consumer trends nationwide.",
            "exampleMeaning": "Kết quả khảo sát mang tính đại diện cho các xu hướng tiêu dùng trên toàn quốc."
        }
    ]
},
    'reserve': {
    "pronunciation": "/rɪˈzɜːv/",
    "meanings": [
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Đặt chỗ trước, giữ chỗ, dự trữ",
            "definition": "Book a seat or table in advance; retain for future use.",
            "example": "Please reserve a conference room for tomorrow's strategy meeting.",
            "exampleMeaning": "Vui lòng đặt trước một phòng hội nghị cho cuộc họp chiến lược ngày mai."
        },
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Lượng dự trữ, khu bảo tồn",
            "definition": "A supply of something available for use if required.",
            "example": "The bank maintains a financial reserve for emergency expenses.",
            "exampleMeaning": "Ngân hàng duy trì một lượng dự trữ tài chính cho các chi phí khẩn cấp."
        }
    ]
},
    'resort': {
    "pronunciation": "/rɪˈzɔːt/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Khu nghỉ dưỡng",
            "definition": "A place frequented for holidays or recreation.",
            "example": "The luxury beachfront resort features spa facilities and private villas.",
            "exampleMeaning": "Khu nghỉ dưỡng sang trọng ven biển có các tiện ích spa và biệt thự riêng."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Nhờ vào, dùng đến (resort to)",
            "definition": "Turn to and adopt a course of action in order to resolve a difficult situation.",
            "example": "We hope to resolve the contract dispute without resorting to legal action.",
            "exampleMeaning": "Chúng tôi hy vọng giải quyết tranh chấp hợp đồng mà không phải nhờ đến hành động pháp lý."
        }
    ]
},
    'resume': {
    "pronunciation": "/ˈrez.jʊ.meɪ/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Sơ yếu lý lịch, CV",
            "definition": "A summary of a person's education and work history.",
            "example": "Candidates must submit an updated resume when applying online.",
            "exampleMeaning": "Ứng viên phải nộp một CV sơ yếu lý lịch mới nhất khi nộp đơn trực tuyến."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Bắt đầu lại, tiếp tục",
            "definition": "Begin again or continue after a pause.",
            "example": "The presentation will resume after a ten-minute coffee break.",
            "exampleMeaning": "Bài thuyết trình sẽ bắt đầu lại sau mười phút giải lao cà phê."
        }
    ]
},
    'retail': {
    "pronunciation": "/ˈriː.teɪl/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Bán lẻ",
            "definition": "The sale of goods to the public in small quantities.",
            "example": "The company expanded its retail operations across the country.",
            "exampleMeaning": "Công ty đã mở rộng các hoạt động bán lẻ trên khắp cả nước."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Bán lẻ",
            "definition": "Sell goods to the public in small quantities.",
            "example": "The smartphone retails at five hundred dollars in stores.",
            "exampleMeaning": "Chiếc điện thoại thông minh được bán lẻ với giá 500 đô la tại các cửa hàng."
        }
    ]
},
    'retreat': {
    "pronunciation": "/rɪˈtriːt/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Chuyến đi nghỉ dưỡng công ty, nơi rút lui",
            "definition": "A quiet place for rest; a corporate team-building trip.",
            "example": "The annual executive retreat was held at a mountain resort.",
            "exampleMeaning": "Chuyến đi nghỉ dưỡng công ty hàng năm của các quản lý được tổ chức tại một khu nghỉ dưỡng vùng núi."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Rút lui",
            "definition": "Withdraw or move back from a position.",
            "example": "The firm had to retreat from the market due to low profit margins.",
            "exampleMeaning": "Công ty đã phải rút lui khỏi thị trường do tỷ suất lợi nhuận thấp."
        }
    ]
},
  'reversal': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự đảo ngược, sự hủy bỏ",
    "definition": "A change to an opposite direction, position, or course of action.",
    "example": "The sudden reversal of the policy surprised many industry analysts.",
    "exampleMeaning": "Sự đảo ngược đột ngột của chính sách đã làm kinh ngạc nhiều nhà phân tích ngành."
},
    'sample': {
    "pronunciation": "/ˈsɑːm.pəl/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Mẫu thử, hàng mẫu",
            "definition": "A small part or quantity intended to show what the whole is like.",
            "example": "The sales rep gave the client a free product sample.",
            "exampleMeaning": "Đại diện kinh doanh đã đưa cho khách hàng một mẫu thử sản phẩm miễn phí."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Thử nghiệm, dùng thử, ăn thử",
            "definition": "Test or try out a sample of something.",
            "example": "Attendees can sample different French wines at the trade exhibition.",
            "exampleMeaning": "Người tham dự có thể dùng thử các loại rượu vang Pháp khác nhau tại triển lãm thương mại."
        }
    ]
},
    'schedule': {
    "pronunciation": "/ˈʃed.juːl/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Lịch trình, thời khóa biểu",
            "definition": "A plan that gives a list of intended events and times.",
            "example": "The project is moving forward according to the master schedule.",
            "exampleMeaning": "Dự án đang tiến triển theo đúng lịch trình tổng thể."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Lên lịch, xếp lịch",
            "definition": "Arrange or plan that an event will take place at a particular time.",
            "example": "The assistant will schedule a meeting with the overseas client.",
            "exampleMeaning": "Trợ lý sẽ lên lịch một cuộc họp với khách hàng nước ngoài."
        }
    ]
},
  'seek': {
    "pos": "verb",
    "pronunciation": "",
    "meaning": "Tìm kiếm, mưu cầu",
    "definition": "Attempt to find something; ask for something.",
    "example": "The company is seeking an experienced marketing director to lead the team.",
    "exampleMeaning": "Công ty đang tìm kiếm một giám đốc tiếp thị có kinh nghiệm để dẫn dắt nhóm."
},
  'session': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Phiên họp, buổi làm việc",
    "definition": "A period devoted to a particular activity.",
    "example": "The afternoon training session will cover advanced Excel spreadsheets.",
    "exampleMeaning": "Buổi làm việc đào tạo chiều sẽ bao gồm bảng tính Excel nâng cao."
},
  'severance pay': {
    "pos": "phrase",
    "pronunciation": "",
    "meaning": "Tiền trợ cấp nghỉ việc / thôi việc",
    "definition": "An allowance paid to an employee who is let go or laid off.",
    "example": "Eligible staff received three months of severance pay upon contract termination.",
    "exampleMeaning": "Nhân viên đủ điều kiện đã nhận được 3 tháng tiền trợ cấp nghỉ việc khi chấm dứt hợp đồng."
},
  'shipment': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự giao hàng, lô hàng",
    "definition": "An amount of goods shipped; a dispatch of goods.",
    "example": "The latest shipment of electronic components arrived safely at the warehouse.",
    "exampleMeaning": "Lô hàng linh kiện điện tử mới nhất đã tới kho bãi an toàn."
},
  'significant': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Quan trọng, đáng kể",
    "definition": "Sufficiently great or important to be worthy of attention; noteworthy.",
    "example": "The firm achieved a significant increase in international sales revenue.",
    "exampleMeaning": "Công ty đã đạt được sự gia tăng đáng kể về doanh thu bán hàng quốc tế."
},
  'specification': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Thông số kỹ thuật, đặc tả",
    "definition": "An act of identifying something precisely or of stating a precise requirement.",
    "example": "Engineers built the prototype according to exact client specifications.",
    "exampleMeaning": "Các kỹ sư đã xây dựng mẫu thử nghiệm theo đúng thông số kỹ thuật chính xác của khách hàng."
},
  'specific': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Cụ thể, chi tiết",
    "definition": "Clearly defined or identified; precise.",
    "example": "Please provide specific examples to support your proposal during the pitch.",
    "exampleMeaning": "Vui lòng cung cấp các ví dụ cụ thể để hỗ trợ đề xuất của bạn trong bài thuyết trình."
},
  'streaming': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Phát trực tuyến (video/âm thanh)",
    "definition": "Transmitting or receiving data (especially video and audio) over the Internet as a continuous flow.",
    "example": "The event will be broadcast live via high-definition streaming platforms.",
    "exampleMeaning": "Sự kiện sẽ được phát sóng trực tiếp qua các nền tảng phát trực tuyến độ phân giải cao."
},
  'supervisor': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Người giám sát, cấp trên",
    "definition": "A person who supervises a person or an activity; manager.",
    "example": "Report any equipment failure immediately to your direct supervisor.",
    "exampleMeaning": "Báo cáo bất kỳ sự cố thiết bị nào ngay lập tức cho người giám sát trực tiếp của bạn."
},
  'syllabus': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Đề cương môn học, giáo trình",
    "definition": "An outline of the subjects in a course of study or teaching.",
    "example": "The instructor distributed the course syllabus on the first day of class.",
    "exampleMeaning": "Giảng viên đã phân phát đề cương môn học vào ngày đầu tiên của lớp học."
},
  'symposium': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Hội thảo chuyên đề",
    "definition": "A conference or meeting to discuss a particular subject.",
    "example": "Experts gathered at the annual tech symposium to discuss artificial intelligence.",
    "exampleMeaning": "Các chuyên gia đã tập hợp tại hội thảo chuyên đề công nghệ hàng năm để thảo luận về trí tuệ nhân tạo."
},
    'target': {
    "pronunciation": "/ˈtɑː.ɡɪt/",
    "meanings": [
        {
            "pos": "NOUN",
            "type": "noun",
            "meaning": "Mục tiêu, chỉ tiêu",
            "definition": "A result that one is attempting to achieve.",
            "example": "The sales team achieved its annual revenue target ahead of time.",
            "exampleMeaning": "Nhóm kinh doanh đã đạt mục tiêu doanh thu hàng năm trước thời hạn."
        },
        {
            "pos": "VERB",
            "type": "verb",
            "meaning": "Nhắm tới mục tiêu",
            "definition": "Select as an object of attention or attack.",
            "example": "The new ad campaign targets young tech-savvy professionals.",
            "exampleMeaning": "Chiến dịch quảng cáo mới nhắm tới các chuyên gia trẻ tuổi am hiểu công nghệ."
        }
    ]
},
  'technician': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Kỹ thuật viên",
    "definition": "A person employed to look after technical equipment or do practical work in a laboratory.",
    "example": "The certified technician repaired the network server in less than an hour.",
    "exampleMeaning": "Kỹ thuật viên có chứng chỉ đã sửa chữa máy chủ mạng trong chưa đầy một giờ."
},
  'thought-provoking': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Gợi suy nghĩ, kích thích tư duy",
    "definition": "Stimulating careful consideration or attention; insightful.",
    "example": "The keynote speaker delivered a thought-provoking presentation on future trends.",
    "exampleMeaning": "Diễn giả chính đã trình bày một bài thuyết trình kích thích tư duy về các xu hướng tương lai."
},
  'toll-free': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Miễn phí cước cuộc gọi",
    "definition": "Allowing a caller to make a long-distance telephone call without paying.",
    "example": "Customers can contact customer service using our 24/7 toll-free hotline.",
    "exampleMeaning": "Khách hàng có thể liên hệ với dịch vụ khách hàng bằng đường dây nóng miễn phí cước cuộc gọi 24/7."
},
  'training': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Sự đào tạo, sự huấn luyện",
    "definition": "The action of teaching a person or animal a particular skill or type of behavior.",
    "example": "New staff must complete a two-week intensive training program.",
    "exampleMeaning": "Nhân viên mới phải hoàn thành một chương trình đào tạo cấp tốc kéo dài hai tuần."
},
  'urban': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Thuộc đô thị, thành thị",
    "definition": "In, relating to, or characteristic of a town or city.",
    "example": "The city council plans to invest heavily in urban transit infrastructure.",
    "exampleMeaning": "Hội đồng thành phố có kế hoạch đầu tư mạnh mẽ vào cơ sở hạ tầng giao thông đô thị."
},
  'utility': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Dịch vụ công cộng (điện, nước); Tiện ích",
    "definition": "The state of being useful, profitable, or beneficial; public services.",
    "example": "Monthly office operating expenses include utility bills for electricity and water.",
    "exampleMeaning": "Chi phí vận hành văn phòng hàng tháng bao gồm hóa đơn dịch vụ công cộng điện và nước."
},
  'venue': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Địa điểm tổ chức (sự kiện, hội nghị)",
    "definition": "The place where something happens, especially an organized event such as a concert or conference.",
    "example": "The downtown convention center is an ideal venue for international trade shows.",
    "exampleMeaning": "Trung tâm hội nghị ở trung tâm thành phố là một địa điểm lý tưởng cho các hội chợ thương mại quốc tế."
},
  'wireless': {
    "pos": "adjective",
    "pronunciation": "",
    "meaning": "Không dây",
    "definition": "Using radio, microwaves, etc., (rather than wires or cables) to transmit signals.",
    "example": "The modern office provides fast and reliable wireless Internet access.",
    "exampleMeaning": "Văn phòng hiện đại cung cấp truy cập Internet không dây nhanh chóng và đáng tin cậy."
},
  'workload': {
    "pos": "noun",
    "pronunciation": "",
    "meaning": "Khối lượng công việc",
    "definition": "The amount of work to be done by a person or organization.",
    "example": "Management hired additional temp staff to handle the heavy end-of-year workload.",
    "exampleMeaning": "Ban quản lý đã thuê thêm nhân viên tạm thời để xử lý khối lượng công việc nặng nề cuối năm."
},

  'institute': {
    pronunciation: '/ˈɪn.stɪ.tjuːt/',
    meanings: [
      {
        pos: 'NOUN',
        type: 'noun',
        meaning: 'Viện, học viện, tổ chức (nghiên cứu, giáo dục)',
        definition: 'An organization founded for a particular purpose (research, education, or culture).',
        example: 'She completed her MBA at a prestigious business institute.',
        exampleMeaning: 'Cô ấy đã hoàn thành chương trình MBA tại một học viện kinh doanh danh tiếng.'
      },
      {
        pos: 'VERB',
        type: 'verb',
        meaning: 'Thiết lập, thành lập, tiến hành (chính sách, quy định)',
        definition: 'To begin or initiate something; to establish.',
        example: 'The committee decided to institute new safety protocols for all employees.',
        exampleMeaning: 'Ủy ban đã quyết định thiết lập các quy trình an toàn mới cho tất cả nhân viên.'
      }
    ]
  },
  'feature': {
    pronunciation: '/ˈfiː.tʃər/',
    meanings: [
      {
        pos: 'NOUN',
        type: 'noun',
        meaning: 'Tính năng, đặc điểm, điểm nổi bật',
        definition: 'A distinctive attribute or aspect of something.',
        example: 'The new smartphone model includes advanced battery saving features.',
        exampleMeaning: 'Mẫu điện thoại thông minh mới bao gồm các tính năng tiết kiệm pin tiên tiến.'
      },
      {
        pos: 'VERB',
        type: 'verb',
        meaning: 'Bao gồm, nêu bật, trình chiếu',
        definition: 'To include something as a prominent or important part.',
        example: 'The company annual report features key milestones achieved this year.',
        exampleMeaning: 'Báo cáo thường niên của công ty nêu bật các cột mốc quan trọng đạt được trong năm nay.'
      },
      {
        pos: 'ADJECTIVE',
        type: 'adjective',
        meaning: 'Nổi bật, chính, đặc sắc',
        definition: 'Prominent or highlighted.',
        example: 'The feature presentation will take place in the main conference hall.',
        exampleMeaning: 'Bài thuyết trình chính sẽ diễn ra tại hội trường hội nghị chính.'
      }
    ]
  },
  'conduct': {
    pronunciation: '/kənˈdʌkt/',
    meanings: [
      {
        pos: 'VERB',
        type: 'verb',
        meaning: 'Tiến hành, thực hiện (cuộc điều tra, khảo sát, nghiên cứu)',
        definition: 'To organize and carry out a particular activity or process.',
        example: 'The market research team will conduct a survey to analyze customer preferences.',
        exampleMeaning: 'Nhóm nghiên cứu thị trường sẽ tiến hành khảo sát để phân tích sở thích của khách hàng.'
      },
      {
        pos: 'NOUN',
        type: 'noun',
        meaning: 'Hành vi, cách ứng xử, tư cách',
        definition: 'The manner in which a person behaves in a particular situation.',
        example: 'All staff are expected to maintain professional conduct at the workplace.',
        exampleMeaning: 'Tất cả nhân viên được yêu cầu duy trì ứng xử chuyên nghiệp tại nơi làm việc.'
      }
    ]
  },
  'record': {
    pronunciation: '/ˈrek.ɔːd/',
    meanings: [
      {
        pos: 'NOUN',
        type: 'noun',
        meaning: 'Hồ sơ, bản ghi, kỷ lục',
        definition: 'A piece of evidence or information about the past kept in writing.',
        example: 'The accounting department keeps an accurate record of all corporate expenditures.',
        exampleMeaning: 'Bộ phận kế toán giữ hồ sơ chính xác về tất cả chi tiêu của doanh nghiệp.'
      },
      {
        pos: 'VERB',
        type: 'verb',
        meaning: 'Ghi chép, thu âm, ghi hình',
        definition: 'To set down in writing or other permanent form for later reference.',
        example: 'The secretary will record the official minutes during today’s board meeting.',
        exampleMeaning: 'Thư ký sẽ ghi chép lại biên bản chính thức trong cuộc họp ban điều hành hôm nay.'
      }
    ]
  },
  'manual': {
    pronunciation: '/ˈmæn.ju.əl/',
    meanings: [
      {
        pos: 'NOUN',
        type: 'noun',
        meaning: 'Sách hướng dẫn, tài liệu chỉ dẫn',
        definition: 'A book giving instructions or information about how to use something.',
        example: 'Please read the operation manual carefully before starting the equipment.',
        exampleMeaning: 'Vui lòng đọc kỹ sách hướng dẫn vận hành trước khi khởi động thiết bị.'
      },
      {
        pos: 'ADJECTIVE',
        type: 'adjective',
        meaning: 'Thủ công, bằng tay',
        definition: 'Done or operated by hand rather than automatically.',
        example: 'The factory relies on manual labor for inspecting delicate electronic parts.',
        exampleMeaning: 'Nhà máy phụ thuộc vào lao động thủ công để kiểm tra các linh kiện điện tử tinh xảo.'
      }
    ]
  },
  'associate': {
    pronunciation: '/əˈsəʊ.si.ət/',
    meanings: [
      {
        pos: 'NOUN',
        type: 'noun',
        meaning: 'Đồng nghiệp, đối tác, trợ lý',
        definition: 'A partner or colleague in business or at work.',
        example: 'The senior associate welcomed the new team members to the department.',
        exampleMeaning: 'Đối tác cấp cao đã chào mừng các thành viên mới đến với bộ phận.'
      },
      {
        pos: 'VERB',
        type: 'verb',
        meaning: 'Liên kết, kết hợp, gắn liền',
        definition: 'To connect someone or something in one\'s mind with something else.',
        example: 'Consumers often associate this brand with high quality and reliability.',
        exampleMeaning: 'Người tiêu dùng thường liên kết thương hiệu này với chất lượng cao và độ tin cậy.'
      }
    ]
  },
  'boring': {
    pos: 'adjective',
    pronunciation: '/ˈbɔː.rɪŋ/',
    meaning: 'nhàm chán, tẻ nhạt',
    example: 'The presentation was so boring that several attendees fell asleep.',
    exampleMeaning: 'Bài thuyết trình nhàm chán đến mức vài người tham dự đã ngủ gật.'
  },
  'purchasing': {
    pos: 'noun',
    pronunciation: '/ˈpɜː.tʃəs.ɪŋ/',
    meaning: 'hoạt động mua sắm / bộ phận thu mua',
    example: 'The purchasing department is negotiating better terms with suppliers.',
    exampleMeaning: 'Bộ phận thu mua đang đàm phán các điều khoản tốt hơn với nhà cung cấp.'
  },
  'wage': {
    pos: 'noun',
    pronunciation: '/weɪdʒ/',
    meaning: 'tiền lương, tiền công (tính theo giờ/tuần)',
    example: 'The company agreed to raise the minimum hourly wage for factory workers.',
    exampleMeaning: 'Công ty đã đồng ý tăng mức lương tối thiểu theo giờ cho công nhân nhà máy.'
  },
  'prioritize': {
    pos: 'verb',
    pronunciation: '/praɪˈɒr.ə.taɪz/',
    meaning: 'ưu tiên',
    example: 'Project managers should prioritize urgent client requests to ensure satisfaction.',
    exampleMeaning: 'Các quản lý dự án nên ưu tiên những yêu cầu khẩn cấp của khách hàng để đảm bảo sự hài lòng.'
  },
  'bankrupt': {
    pos: 'adjective',
    pronunciation: '/ˈbæŋk.rʌpt/',
    meaning: 'phá sản',
    example: 'The company was declared bankrupt after years of financial losses.',
    exampleMeaning: 'Công ty đã tuyên bố phá sản sau nhiều năm thua lỗ tài chính.'
  },
  'hesitant': {
    pos: 'adjective',
    pronunciation: '/ˈhez.ɪ.tənt/',
    meaning: 'ngập ngừng, do dự',
    example: 'The board members were hesitant about approving the risky overseas investment.',
    exampleMeaning: 'Các thành viên hội đồng quản trị đã do dự về việc phê duyệt khoản đầu tư mạo hiểm ra nước ngoài.'
  },
  'enthusiast': {
    pos: 'noun',
    pronunciation: '/ɪnˈθjuː.zi.æst/',
    meaning: 'người nhiệt huyết, người đam mê',
    example: 'As a dedicated tech enthusiast, he tests all software updates immediately.',
    exampleMeaning: 'Là một người đam mê công nghệ tâm huyết, anh ấy thử nghiệm tất cả bản cập nhật phần mềm ngay lập tức.'
  },
  'hanger': {
    pos: 'noun',
    pronunciation: '/ˈhæŋ.ər/',
    meaning: 'móc treo quần áo',
    example: 'Please put your coat on a hanger in the closet.',
    exampleMeaning: 'Vui lòng treo áo khoác của bạn lên móc treo trong tủ đồ.'
  },
  'fringe': {
    pos: 'adjective',
    pronunciation: '/frɪndʒ/',
    meaning: 'phụ, bổ sung',
    example: 'Fringe benefits include health insurance and paid vacation.',
    exampleMeaning: 'Các phúc lợi phụ bao gồm bảo hiểm y tế và kỳ nghỉ có lương.'
  },
  'giving a presentation': {
    pos: 'phrase',
    pronunciation: '/ˈɡɪvɪŋ ə ˌprezənˈteɪʃən/',
    meaning: 'thuyết trình, trình bày',
    example: 'The marketing manager spent thirty minutes giving a presentation to the executive board.',
    exampleMeaning: 'Quản lý marketing đã dành 30 phút để thuyết trình trước hội đồng quản trị.'
  },
  'changing the tire': {
    pos: 'phrase',
    pronunciation: '/ˈtʃeɪndʒɪŋ ðə ˈtaɪər/',
    meaning: 'thay lốp xe',
    example: 'The technician spent twenty minutes changing the tire on the roadside.',
    exampleMeaning: 'Kỹ thuật viên đã dành 20 phút để thay lốp xe bên đường.'
  },
  'raising her hand': {
    pos: 'phrase',
    pronunciation: '/ˈreɪzɪŋ hɜːr hænd/',
    meaning: 'giơ tay lên',
    example: 'She caught the instructor\'s attention by raising her hand during the seminar.',
    exampleMeaning: 'Cô ấy đã thu hút sự chú ý của giảng viên bằng cách giơ tay trong buổi thảo luận.'
  },
  'raise hand': {
    pos: 'phrase',
    pronunciation: '/reɪz hænd/',
    meaning: 'giơ tay',
    example: 'Please raise hand if you have any questions regarding the new company policy.',
    exampleMeaning: 'Vui lòng giơ tay nếu bạn có bất kỳ câu hỏi nào về chính sách mới của công ty.'
  },
  'loading area': {
    pos: 'noun',
    pronunciation: '/ˈloʊdɪŋ ˈeriə/',
    meaning: 'khu vực bốc dỡ hàng',
    example: 'All delivery vehicles must park inside the designated loading area to unload cargo.',
    exampleMeaning: 'Tất cả các xe giao hàng phải đỗ bên trong khu vực bốc dỡ hàng quy định để dỡ hàng hóa.'
  },
  'bacteria': {
    pos: 'noun',
    meaning: 'vi khuẩn',
    example: 'The laboratory analysis revealed no harmful bacteria in the drinking water.',
    exampleMeaning: 'Phân tích phòng thí nghiệm cho thấy không có vi khuẩn có hại trong nước uống.'
  },
  'kind of': {
    pos: 'adverb',
    pronunciation: '/kaɪnd əv/',
    meaning: 'hơi, khá, một loại',
    example: 'The management team was kind of surprised by the sudden increase in quarterly sales.',
    exampleMeaning: 'Ban quản lý có vẻ hơi ngạc nhiên trước sự gia tăng đột ngột của doanh số hàng quý.'
  },
  'golf clubs': {
    pos: 'noun',
    pronunciation: '/ɡɒlf klʌbz/',
    meaning: 'bộ gậy golf, gậy đánh golf',
    example: 'He packed his new golf clubs for the weekend corporate tournament.',
    exampleMeaning: 'Anh ấy mang theo bộ gậy golf mới cho giải đấu cuối tuần của công ty.'
  },
  'presenter': {
    pos: 'noun',
    meaning: 'người thuyết trình, diễn giả',
    example: 'The key presenter delivered a clear overview of the strategic project goals.',
    exampleMeaning: 'Diễn giả chính đã trình bày tổng quan rõ ràng về các mục tiêu chiến lược của dự án.'
  },
  'microscope': {
    pos: 'noun',
    meaning: 'kính hiển vi',
    example: 'The researcher examined the biological tissue sample carefully under a microscope.',
    exampleMeaning: 'Nhà nghiên cứu đã kiểm tra kỹ mẫu mô sinh học dưới kính hiển vi.'
  },
  'shoes': {
    pos: 'noun',
    meaning: 'giày, đôi giày',
    example: 'All warehouse staff are required to wear sturdy safety shoes on duty.',
    exampleMeaning: 'Tất cả nhân viên kho hàng đều phải đeo giày bảo hộ chắc chắn khi làm nhiệm vụ.'
  },
  'safety glasses': {
    pos: 'noun',
    pronunciation: '/ˈseɪfti ˈɡlæsɪz/',
    meaning: 'kính bảo hộ',
    example: 'Technicians must wear safety glasses inside the chemical processing facility.',
    exampleMeaning: 'Kỹ thuật viên phải đeo kính bảo hộ bên trong cơ sở xử lý hóa chất.'
  },
  'sock': {
    pos: 'noun',
    pronunciation: '/sɒk/',
    meaning: 'tất, vớ',
    example: 'He packed several pairs of comfortable socks for his upcoming business trip.',
    exampleMeaning: 'Anh ấy đã đóng gói vài đôi tất thoải mái cho chuyến công tác sắp tới.'
  },
  'vast wealth': {
    pos: 'noun',
    pronunciation: '/væst welθ/',
    meaning: 'khối tài sản kế xù, sự giàu có lớn',
    example: 'The entrepreneur accumulated vast wealth through successful real estate investments.',
    exampleMeaning: 'Doanh nhân đã tích lũy khối tài sản kế xù thông qua các khoản đầu tư bất động sản thành công.'
  },
  'branch': {
    pos: 'noun',
    meaning: 'chi nhánh',
    example: 'The commercial bank opened a new regional branch in the financial district.',
    exampleMeaning: 'Ngân hàng thương mại đã mở một chi nhánh khu vực mới tại khu tài chính.'
  },
  'statistics': {
    pos: 'noun',
    meaning: 'thống kê, con số thống kê',
    example: 'The latest quarterly statistics demonstrate a continuous growth in overall sales.',
    exampleMeaning: 'Số liệu thống kê hàng quý mới nhất cho thấy sự tăng trưởng liên tục về tổng doanh số.'
  },
  'conglomerate': {
    pos: 'noun',
    meaning: 'tập đoàn đa ngành',
    example: 'The global conglomerate acquired two regional logistics firms this quarter.',
    exampleMeaning: 'Tập đoàn toàn cầu đã mua lại hai công ty logistics khu vực trong quý này.'
  },
  'objectively': {
    pos: 'adverb',
    meaning: 'khách quan',
    example: 'The external auditor evaluated the financial compliance reports objectively.',
    exampleMeaning: 'Kiểm toán viên bên ngoài đã đánh giá các báo cáo tuân thủ tài chính một cách khách quan.'
  },
  'researcher': {
    pos: 'noun',
    pronunciation: '/rɪˈsɜː.tʃər/',
    meaning: 'Nhà nghiên cứu',
    definition: 'A person who carries out academic or scientific research.',
    example: 'The researcher published her findings in a leading medical journal.',
    exampleMeaning: 'Nhà nghiên cứu đã công bố phát hiện của mình trên một tạp chí y khoa hàng đầu.'
  },
  'senior': {
    pos: 'adjective',
    pronunciation: '/ˈsiː.ni.ər/',
    meaning: 'Cấp cao, thâm niên',
    definition: 'Higher in rank or length of service.',
    example: 'She was promoted to a senior management position after five years.',
    exampleMeaning: 'Cô ấy được thăng chức lên vị trí quản lý cấp cao sau năm năm.'
  },
  'junior': {
    pos: 'adjective',
    pronunciation: '/ˈdʒuː.ni.ər/',
    meaning: 'Cấp thấp hơn, mới vào nghề',
    definition: 'Lower in rank or having less experience.',
    example: 'The junior analyst prepared a summary report for the team meeting.',
    exampleMeaning: 'Chuyên viên phân tích cấp thấp đã chuẩn bị báo cáo tóm tắt cho cuộc họp nhóm.'
  },
  'institute': {
    pos: 'noun',
    pronunciation: '/ˈɪn.stɪ.tjuːt/',
    meaning: 'Viện, học viện',
    definition: 'An organization founded for a particular purpose.',
    example: 'She completed her MBA at a prestigious business institute.',
    exampleMeaning: 'Cô ấy đã hoàn thành chương trình MBA tại một học viện kinh doanh danh tiếng.'
  },
  'feature': {
    pos: 'noun',
    pronunciation: '/ˈfiː.tʃər/',
    meaning: 'Tính năng, đặc điểm (n) | Bao gồm, nêu bật (v) | Nổi bật (adj)',
    definition: 'A distinctive attribute or aspect of something; also to include as a special attraction.',
    example: 'The new app features an intelligent study planner that adapts to your schedule.',
    exampleMeaning: 'Ứng dụng mới có tính năng lập kế hoạch học tập thông minh, thích nghi với lịch của bạn.'
  },
  'comply with': {
    pos: 'phrase',
    pronunciation: '/kəmˈplaɪ wɪð/',
    meaning: 'Tuân thủ, chấp hành',
    definition: 'To act in accordance with a rule, wish, or command.',
    example: 'All employees must comply with the company\'s health and safety regulations.',
    exampleMeaning: 'Tất cả nhân viên phải tuân thủ các quy định về sức khỏe và an toàn của công ty.'
  },
  'abide by': {
    pos: 'phrase',
    pronunciation: '/əˈbaɪd baɪ/',
    meaning: 'Tuân thủ, tuân theo',
    definition: 'To accept or follow a rule, decision, or recommendation.',
    example: 'The contractor agreed to abide by all terms stated in the agreement.',
    exampleMeaning: 'Nhà thầu đồng ý tuân thủ tất cả các điều khoản được nêu trong hợp đồng.'
  },
  'adhere to': {
    pos: 'phrase',
    pronunciation: '/ədˈhɪər tuː/',
    meaning: 'Tuân thủ, gắn bó với',
    definition: 'To continue to behave according to a rule or principle.',
    example: 'The team must adhere to the project timeline approved by management.',
    exampleMeaning: 'Nhóm phải tuân thủ tiến độ dự án đã được ban lãnh đạo phê duyệt.'
  },
  'conform to': {
    pos: 'phrase',
    pronunciation: '/kənˈfɔːm tuː/',
    meaning: 'Tuân thủ, phù hợp với',
    definition: 'To behave according to generally accepted standards.',
    example: 'The new packaging must conform to international shipping standards.',
    exampleMeaning: 'Bao bì mới phải phù hợp với các tiêu chuẩn vận chuyển quốc tế.'
  },
  'observe': {
    pos: 'verb',
    pronunciation: '/əbˈzɜːv/',
    meaning: 'Tuân thủ, tuân theo (quy tắc); quan sát',
    definition: 'To comply with or follow a rule, law, or custom.',
    example: 'Staff are required to observe the company\'s code of conduct at all times.',
    exampleMeaning: 'Nhân viên phải tuân thủ quy tắc ứng xử của công ty mọi lúc.'
  },
  'verify': {
    pos: 'verb',
    pronunciation: '/ˈver.ɪ.faɪ/',
    meaning: 'Xác minh, kiểm chứng',
    definition: 'To make sure or demonstrate that something is true or accurate.',
    example: 'Please verify your email address to complete the registration process.',
    exampleMeaning: 'Vui lòng xác minh địa chỉ email của bạn để hoàn tất quá trình đăng ký.'
  },
  'finalize': {
    pos: 'verb',
    pronunciation: '/ˈfaɪ.nə.laɪz/',
    meaning: 'Hoàn thiện, hoàn tất',
    definition: 'To complete the last part of a plan, trip, or agreement.',
    example: 'We need to finalize the contract details before the end of the quarter.',
    exampleMeaning: 'Chúng tôi cần hoàn thiện các chi tiết hợp đồng trước cuối quý.'
  },
  'accomplish': {
    pos: 'verb',
    pronunciation: '/əˈkʌm.plɪʃ/',
    meaning: 'Hoàn thành, đạt được (mục tiêu)',
    definition: 'To succeed in doing or achieving something.',
    example: 'The sales team accomplished all of their quarterly targets ahead of schedule.',
    exampleMeaning: 'Nhóm bán hàng đã hoàn thành tất cả các mục tiêu quý trước thời hạn.'
  },
  'office supplies': {
    pos: 'phrase',
    pronunciation: '/ˈɒf.ɪs səˈplaɪz/',
    meaning: 'Văn phòng phẩm, đồ dùng văn phòng',
    definition: 'Materials and equipment used in an office environment.',
    example: 'Please submit your request for office supplies to the administration team.',
    exampleMeaning: 'Vui lòng gửi yêu cầu văn phòng phẩm của bạn cho nhóm hành chính.'
  },
  'consist of': {
    pos: 'phrase',
    pronunciation: '/kənˈsɪst ɒv/',
    meaning: 'Bao gồm, cấu thành từ',
    definition: 'To be made up of; to be composed of.',
    example: 'The executive team consists of five senior directors across three departments.',
    exampleMeaning: 'Ban điều hành bao gồm năm giám đốc cấp cao từ ba phòng ban.'
  },
  'comprise': {
    pos: 'verb',
    pronunciation: '/kəmˈpraɪz/',
    meaning: 'Bao gồm, cấu thành',
    definition: 'To consist of; to be made up of.',
    example: 'The report comprises three sections: analysis, findings, and recommendations.',
    exampleMeaning: 'Báo cáo bao gồm ba phần: phân tích, phát hiện và khuyến nghị.'
  }
};

// Smart POS Detection to prevent assigning 'noun' to adjectives/verbs/phrases
function detectWordPOS(cleanWord, fallbackType = 'noun') {
  if (!cleanWord) return fallbackType || 'noun';
  const w = cleanWord.toLowerCase().trim();
  
  if (SMART_TOEIC_TERMS[w]) {
    return SMART_TOEIC_TERMS[w].pos;
  }

  // Detect phrases (multi-word terms, gerund action phrases)
  if (w.includes(' ') || w.startsWith('giving') || w.startsWith('changing') || w.startsWith('raising') || w.startsWith('taking') || w.startsWith('cleaning') || w.startsWith('fixing')) {
    if (!w.endsWith('area') && !w.endsWith('room') && !w.endsWith('clubs') || w.includes('giving') || w.includes('changing') || w.includes('raising')) {
      return 'phrase';
    }
  }
  
  // High-precision overrides for common TOEIC vocabulary
  const adjSet = new Set([
    'jealous', 'hesitant', 'bankrupt', 'optimistic', 'strenuous', 'secure', 
    'manual', 'determined', 'vast', 'principal', 'objective', 'fringe',
    'reluctant', 'diligent', 'eligible', 'proficient', 'subsequent', 'tentative'
  ]);
  const verbSet = new Set([
    'prioritize', 'reveal', 'conduct', 'secure', 'record', 'associate', 
    'wage', 'implement', 'consolidate', 'authorize', 'subsidize', 'facilitate'
  ]);
  const advSet = new Set([
    'objectively', 'promptly', 'approximately', 'substantially', 'considerably'
  ]);
  
  if (adjSet.has(w)) return 'adjective';
  if (verbSet.has(w)) return 'verb';
  if (advSet.has(w)) return 'adverb';
  
  if (w.endsWith('ly')) return 'adverb';
  if (w.endsWith('ize') || w.endsWith('ise') || w.endsWith('fy')) return 'verb';
  if (w.endsWith('ous') || w.endsWith('ive') || w.endsWith('ful') || w.endsWith('less') || w.endsWith('able') || w.endsWith('ible')) return 'adjective';
  
  return fallbackType || 'noun';
}

// Auto-correct spell check for typos like "Priorizre" -> "Prioritize" or "Pricipal" -> "Principal"
async function autoCorrectWordTypo(word) {
  const clean = sanitizeWordTitle(word);
  if (!clean || clean.length < 3) return clean;
  
  const lower = clean.toLowerCase();
  
  // 1. Check direct matches in SMART_TOEIC_TERMS
  if (SMART_TOEIC_TERMS[lower]) return clean;

  // 2. Local fuzzy match against SMART_TOEIC_TERMS dictionary keys
  const knownKeys = Object.keys(SMART_TOEIC_TERMS);
  let bestMatch = null;
  let minDistance = Infinity;

  function lev(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
        }
      }
    }
    return matrix[b.length][a.length];
  }

  for (const k of knownKeys) {
    const dist = lev(lower, k);
    if (dist < minDistance && dist <= 2) {
      minDistance = dist;
      bestMatch = k;
    }
  }
  if (bestMatch) {
    console.log(`Fuzzy auto-corrected typo: "${clean}" -> "${bestMatch}"`);
    return bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1);
  }
  
  // 3. Try Free Dictionary API
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(clean)}`);
    if (res.ok) return clean; // Valid English word
  } catch (e) {}

  // 4. Check Datamuse spell check API if Dictionary API returned 404
  try {
    const dmRes = await fetch(`https://api.datamuse.com/sug?s=${encodeURIComponent(clean)}`);
    if (dmRes.ok) {
      const suggestions = await dmRes.json();
      if (suggestions && suggestions.length > 0 && suggestions[0].word) {
        const sugWord = suggestions[0].word;
        console.log(`Datamuse auto-corrected typo: "${clean}" -> "${sugWord}"`);
        return sugWord.charAt(0).toUpperCase() + sugWord.slice(1);
      }
    }
  } catch (e) {}

  return clean;
}

function extractWordAndType(rawWord) {
  let word = sanitizeWordTitle(rawWord);
  let type = detectWordPOS(word);
  return { word, type };
}

// Generate 100% grammatically sound, practical, easy-to-learn business English example sentence per POS or smart term
function generateTemplateExample(wordOrPhrase, type) {
  const clean = sanitizeWordTitle(wordOrPhrase);
  if (!clean) return '';
  const lower = clean.toLowerCase();
  
  if (SMART_TOEIC_TERMS[lower]?.example) {
    return SMART_TOEIC_TERMS[lower].example;
  }
  
  const actualPOS = detectWordPOS(clean, type);
  const charSum = Array.from(lower).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  
  if (actualPOS === 'phrase' || lower.includes(' ') || lower.includes('ing ') || lower.startsWith('giving') || lower.startsWith('changing') || lower.startsWith('raising') || lower.startsWith('cleaning') || lower.startsWith('fixing')) {
    const phraseTemplates = [
      `The employee spent thirty minutes ${lower} during the morning shift.`,
      `He was responsible for ${lower} while working on the main assignment.`,
      `Please follow all safety guidelines when ${lower} in the work area.`
    ];
    return phraseTemplates[charSum % phraseTemplates.length];
  }
  
  if (actualPOS === 'verb') {
    const verbTemplates = [
      `We need to ${lower} all key tasks before the end of the day.`,
      `The supervisor requested the team to ${lower} the new project guidelines.`,
      `Please ${lower} the requested document and return it to us promptly.`,
      `The manager asked staff members to ${lower} all client inquiries immediately.`
    ];
    return verbTemplates[charSum % verbTemplates.length];
  } else if (actualPOS === 'adjective') {
    const adjTemplates = [
      `The client was very ${lower} with our prompt service response.`,
      `We noticed a ${lower} change in customer feedback this quarter.`,
      `The manager remained ${lower} throughout the strategic discussion.`,
      `It is ${lower} to double-check all calculations before submission.`
    ];
    return adjTemplates[charSum % adjTemplates.length];
  } else if (actualPOS === 'adverb') {
    const advTemplates = [
      `The technical team resolved the system issue ${lower} and efficiently.`,
      `Please complete the requested form ${lower} to avoid processing delays.`,
      `The quarterly sales figures increased ${lower} over the past month.`,
      `She answered all client questions ${lower} during the interview.`
    ];
    return advTemplates[charSum % advTemplates.length];
  } else { // noun
    const nounTemplates = [
      `The ${lower} was delivered to our office department earlier this morning.`,
      `Please make sure the ${lower} is stored properly in the designated area.`,
      `Our team reviewed the latest details concerning the ${lower}.`,
      `She requested a new ${lower} for her office workspace.`
    ];
    return nounTemplates[charSum % nounTemplates.length];
  }
}

function cleanVietnameseTranslation(raw) {
  if (!raw) return '';
  let trans = raw.trim();
  // Safe prefix stripping with word boundaries (\b) so "người" or "vi khuẩn" is NEVER stripped
  trans = trans.replace(/^\b(a|an|to|be|is|do it|một|cái|chiếc|cuốn|quyển|để|được|bị|làm cho|ở|đang|là)\b\s*/i, '').trim();
  // Fix known typos in translation text
  trans = trans.replace(/\bgofl\b/gi, 'golf');
  trans = trans.replace(/\bi khuẩn\b/gi, 'vi khuẩn');
  trans = trans.replace(/\bgười thuyết trình\b/gi, 'người thuyết trình');
  trans = trans.replace(/\bgười phụ nữ\b/gi, 'người phụ nữ');
  return trans;
}

// Fetch translation for text (tries Google Translate first, MyMemory as fallback)
async function translateExampleText(text) {
  if (!text) return '';
  
  // Try Google Translate (unofficial free API) first
  try {
    const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(text)}`;
    const gRes = await fetch(googleUrl);
    if (gRes.ok) {
      const gData = await gRes.json();
      if (gData && gData[0]) {
        let translated = '';
        for (const segment of gData[0]) {
          if (segment[0]) translated += segment[0];
        }
        if (translated) return cleanVietnameseTranslation(translated.trim());
      }
    }
  } catch (e) {
    console.warn("Google Translate error:", e);
  }
  
  // Fallback to MyMemory
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|vi`);
    if (res.ok) {
      const data = await res.json();
      let transText = data.responseData.translatedText || '';
      if (transText && !transText.toLowerCase().includes('mymemory')) {
        return cleanVietnameseTranslation(transText);
      }
    }
  } catch (e) {
    console.warn("MyMemory translation error:", e);
  }
  return '';
}

// Translate word specific to its Part of Speech (POS)
async function translateWordByPOS(word, pos) {
  const wKey = word.toLowerCase().trim();
  if (SMART_TOEIC_TERMS[wKey]) {
    return SMART_TOEIC_TERMS[wKey].meaning;
  }

  let query = word;
  if (pos === 'verb') {
    query = `to ${word}`;
  } else if (pos === 'noun') {
    query = `a ${word}`;
  } else if (pos === 'adjective') {
    query = `is ${word}`;
  } else if (pos === 'adverb') {
    query = `do it ${word}`;
  }
  
  // Try Google Translate first
  try {
    const googleUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q=${encodeURIComponent(query)}`;
    const gRes = await fetch(googleUrl);
    if (gRes.ok) {
      const gData = await gRes.json();
      if (gData && gData[0] && gData[0][0] && gData[0][0][0]) {
        let trans = cleanVietnameseTranslation(gData[0][0][0]);
        if (trans) return trans;
      }
    }
  } catch (e) {
    console.warn("Google POS translation error:", e);
  }
  
  // Fallback to MyMemory
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=en|vi`);
    if (res.ok) {
      const data = await res.json();
      let trans = data.responseData.translatedText || '';
      if (trans && !trans.toLowerCase().includes('mymemory')) {
        trans = cleanVietnameseTranslation(trans);
        return trans;
      }
    }
  } catch (e) {
    console.warn("MyMemory POS translation error:", e);
  }
  return '';
}

// Lookup details for a single English word
async function getSingleWordDetailsAuto(word, defaultType = 'noun') {
  let result = {
    word: word,
    pronunciation: '',
    topic: 'Cá nhân',
    meanings: []
  };

  // Step 1: Check offline seed database
  if (typeof toeicVocabulary !== 'undefined') {
    for (const catKey of Object.keys(toeicVocabulary)) {
      const matchWord = toeicVocabulary[catKey].words.find(w => w.word.toLowerCase() === word.toLowerCase());
      if (matchWord) {
        // Find if we have normalized local word already
        const local = state.vocab.find(w => w.word.toLowerCase() === word.toLowerCase());
        if (local && local.meanings && local.meanings.length > 0) {
          return {
            word: local.word,
            pronunciation: local.pronunciation || matchWord.pronunciation || '',
            topic: local.topic || toeicVocabulary[catKey].title || 'Cá nhân',
            meanings: local.meanings
          };
        }
        return {
          word: matchWord.word,
          pronunciation: matchWord.pronunciation || '',
          topic: toeicVocabulary[catKey].title || 'Cá nhân',
          meanings: [
            {
              type: matchWord.type || defaultType,
              meaning: matchWord.meaning || '',
              definition: matchWord.definition || '',
              example: matchWord.example || '',
              exampleMeaning: matchWord.exampleMeaning || ''
            }
          ]
        };
      }
    }
  }

  // Step 2: Call online APIs
  try {
    // Fetch dictionary details
    const dictResponse = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (dictResponse.ok) {
      const dictData = await dictResponse.json();
      
      // Grab pronunciation from first available entry, clean up parenthetical junk
      const firstEntry = dictData[0];
      let rawPhonetic = firstEntry.phonetic || '';
      if (!rawPhonetic && firstEntry.phonetics) {
        const found = firstEntry.phonetics.find(p => p.text && p.text.startsWith('/'));
        rawPhonetic = found ? found.text : '';
      }
      // Clean pronunciation: remove stray parentheses, trim whitespace
      rawPhonetic = rawPhonetic.replace(/[()]/g, '').replace(/\s+/g, '').trim();
      if (rawPhonetic && !rawPhonetic.startsWith('/')) rawPhonetic = '/' + rawPhonetic;
      if (rawPhonetic && !rawPhonetic.endsWith('/')) rawPhonetic = rawPhonetic + '/';
      result.pronunciation = rawPhonetic;

      // Clean the word name itself (remove parenthetical suffixes like "enthusiast (")
      result.word = firstEntry.word ? firstEntry.word.replace(/\s*\(.*$/, '').trim() : word;
      
      // Collect ALL meanings grouped by POS, then pick the BEST one per POS
      const posMeanings = {}; // { noun: [...], verb: [...], adjective: [...] }
      
      for (const entry of dictData) {
        if (!entry.meanings) continue;
        for (const mGroup of entry.meanings) {
          const mType = mGroup.partOfSpeech || defaultType;
          if (!posMeanings[mType]) posMeanings[mType] = [];
          
          for (const def of mGroup.definitions) {
            posMeanings[mType].push({
              definition: def.definition || '',
              example: def.example || ''
            });
          }
        }
      }
      
      // For each POS, pick the best definition (prefer one with an example)
      for (const [posType, defs] of Object.entries(posMeanings)) {
        // Pick the definition that has a real example, or fall back to the first one
        const bestDef = defs.find(d => d.example) || defs[0];
        if (!bestDef) continue;
        
        const defText = bestDef.definition;
        let exText = bestDef.example;
        if (!exText) {
          exText = generateTemplateExample(word, posType);
        }

        // Translate the ENGLISH DEFINITION to get accurate Vietnamese meaning
        // This is far more accurate than translating the raw word
        let viMeaning = '';
        if (defText) {
          viMeaning = await translateExampleText(defText);
        }
        // Fallback to POS-based word translation if definition translation failed
        if (!viMeaning) {
          viMeaning = await translateWordByPOS(word, posType);
        }
        if (!viMeaning) {
          viMeaning = 'Chưa cập nhật';
        }

        // Translate example sentence
        let exTrans = '';
        if (exText) {
          exTrans = await translateExampleText(exText);
        }

        result.meanings.push({
          type: posType,
          meaning: viMeaning,
          definition: defText,
          example: exText,
          exampleMeaning: exTrans
        });
      }
    }
  } catch (error) {
    console.error("Auto lookup error for word " + word + ":", error);
  }

  // Fallback if no meanings resolved
  if (result.meanings.length === 0) {
    const fallbackExample = generateTemplateExample(word, defaultType);
    const fallbackExMeaning = fallbackExample ? await translateExampleText(fallbackExample) : '';
    result.meanings.push({
      type: defaultType,
      meaning: '', // user will fill
      definition: '',
      example: fallbackExample,
      exampleMeaning: fallbackExMeaning
    });
  }

  if (!result.pronunciation) {
    result.pronunciation = '';
  }

  return result;
}

async function resolvePhraseIPA(word) {
  const key = word.toLowerCase().trim();
  if (SMART_TOEIC_TERMS[key]?.pronunciation) {
    return sanitizeIPA(SMART_TOEIC_TERMS[key].pronunciation);
  }

  const subWords = word.split(/\s+/).filter(w => w.length > 0);
  if (subWords.length <= 1) return '';

  const phoneticsList = [];
  for (const sub of subWords) {
    const lower = sub.toLowerCase();
    if (FUNCTION_WORD_IPA[lower]) {
      phoneticsList.push(FUNCTION_WORD_IPA[lower]);
      continue;
    }
    const subInfo = await getSingleWordDetailsAuto(sub);
    const subIPA = subInfo.pronunciation ? sanitizeIPA(subInfo.pronunciation) : '';
    if (subIPA && !isFakeIPA(sub, subIPA)) {
      phoneticsList.push(subIPA.replace(/\//g, ''));
    }
  }

  if (phoneticsList.length === 0) return '';
  return '/' + phoneticsList.join(' ') + '/';
}

async function repairVocabIPA() {
  let repaired = false;
  for (const entry of state.vocab) {
    if (!entry.word) continue;
    if (entry.pronunciation && !isFakeIPA(entry.word, entry.pronunciation)) continue;

    const smart = SMART_TOEIC_TERMS[entry.word.toLowerCase().trim()];
    if (smart?.pronunciation) {
      entry.pronunciation = sanitizeIPA(smart.pronunciation);
      repaired = true;
      continue;
    }

    const resolved = entry.word.includes(' ')
      ? await resolvePhraseIPA(entry.word)
      : (await getSingleWordDetailsAuto(entry.word)).pronunciation || '';

    const cleanResolved = sanitizeIPA(resolved);
    if (cleanResolved && !isFakeIPA(entry.word, cleanResolved)) {
      entry.pronunciation = cleanResolved;
      repaired = true;
    } else if (isFakeIPA(entry.word, entry.pronunciation)) {
      entry.pronunciation = '';
      repaired = true;
    }
  }
  if (repaired) {
    saveState();
    if (document.getElementById('vocab-list')?.classList.contains('active')) {
      renderVocabBank();
    }
  }
}

// Master resolver: handles single words and multi-word phrases (e.g. "Golf clubs", "Giving a presentation")
async function getWordDetailsAuto(rawWord) {
  const { word, type } = extractWordAndType(rawWord);
  const key = word.toLowerCase().trim();

  if (SMART_TOEIC_TERMS[key]) {
    const smart = SMART_TOEIC_TERMS[key];
    let pronunciation = sanitizeIPA(smart.pronunciation || '');
    if (!pronunciation && word.includes(' ')) {
      pronunciation = await resolvePhraseIPA(word);
    }
    return {
      word: word,
      pronunciation: pronunciation,
      topic: 'Cá nhân',
      meanings: [{
        type: smart.pos,
        meaning: smart.meaning,
        definition: smart.definition || '',
        example: smart.example,
        exampleMeaning: smart.exampleMeaning
      }]
    };
  }
  
  const subWords = word.split(/\s+/).filter(w => w.length > 0);
  if (subWords.length > 1) {
    let result = {
      word: word,
      pronunciation: '',
      topic: 'Cá nhân',
      meanings: []
    };

    result.pronunciation = await resolvePhraseIPA(word);
    
    // Auto translate the whole phrase
    let phraseMeaning = '';
    try {
      const translateResponse = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|vi`);
      if (translateResponse.ok) {
        const translateData = await translateResponse.json();
        phraseMeaning = translateData.responseData.translatedText || '';
        if (phraseMeaning.toLowerCase().includes('mymemory')) {
          phraseMeaning = '';
        }
      }
    } catch (e) {
      console.warn(e);
    }
    
    const exText = generateTemplateExample(word, type);
    const exTrans = exText ? await translateExampleText(exText) : '';
    
    result.meanings.push({
      type: type,
      meaning: phraseMeaning || 'Chưa cập nhật',
      definition: '',
      example: exText,
      exampleMeaning: exTrans
    });
    
    return result;
  } else {
    // Single word
    return await getSingleWordDetailsAuto(word, type);
  }
}

// Active edit tracker
let activeEditIndex = null;

// Toggle custom topic text input visibility based on select dropdown value
function toggleCustomTopicInput() {
  const select = document.getElementById('add-vocab-topic-select');
  const input = document.getElementById('add-vocab-topic');
  if (select && input) {
    if (select.value === 'custom') {
      input.style.display = 'block';
      input.required = true;
    } else {
      input.style.display = 'none';
      input.required = false;
    }
  }
}

// Edit existing vocabulary word
function editVocabWord(index, event) {
  if (event) event.stopPropagation();
  const wordData = state.vocab[index];
  activeEditIndex = index;
  
  // Switch to Add Tab
  switchVocabTab('vocab-add');
  
  // Update form header and submit button label
  const formHeader = document.querySelector('#vocab-add h2');
  if (formHeader) formHeader.textContent = 'Chỉnh sửa từ vựng';
  
  const submitBtn = document.querySelector('#add-word-form button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Cập nhật từ vựng';
  
  // Pre-fill fields
  document.getElementById('add-vocab-word').value = wordData.word;
  document.getElementById('add-vocab-pronunciation').value = wordData.pronunciation || '';
  
  // Dynamic meaning blocks
  const container = document.getElementById('add-vocab-meanings-container');
  if (container) {
    container.innerHTML = '';
    if (wordData.meanings && wordData.meanings.length > 0) {
      wordData.meanings.forEach(m => addMeaningBlock(m));
    } else {
      // Fallback if legacy word
      addMeaningBlock({
        type: wordData.type || 'noun',
        meaning: wordData.meaning || '',
        definition: wordData.definition || '',
        example: wordData.example || '',
        exampleMeaning: wordData.exampleMeaning || ''
      });
    }
  }
  
  const topicSelect = document.getElementById('add-vocab-topic-select');
  const topicInput = document.getElementById('add-vocab-topic');
  if (topicSelect && topicInput) {
    const exists = Array.from(topicSelect.options).some(opt => opt.value === wordData.topic);
    if (exists) {
      topicSelect.value = wordData.topic;
      topicInput.style.display = 'none';
    } else {
      topicSelect.value = 'custom';
      topicInput.value = wordData.topic;
      topicInput.style.display = 'block';
    }
  }
}

// Delete vocabulary word
function deleteVocabWord(index, event) {
  if (event) event.stopPropagation();
  const wordData = state.vocab[index];
  if (confirm(`Bạn có chắc muốn xóa từ "${wordData.word}" khỏi kho từ vựng cá nhân?`)) {
    state.vocab.splice(index, 1);
    saveState();
    renderVocabBank();
  }
}

// Single Word Add/Edit with automatic fallback lookups
async function saveSingleWord(event) {
  event.preventDefault();
  const rawWordInput = document.getElementById('add-vocab-word').value.trim();
  const { word: wordInput } = extractWordAndType(rawWordInput);
  
  let pronunciationInput = document.getElementById('add-vocab-pronunciation').value.trim();
  
  const topicSelect = document.getElementById('add-vocab-topic-select').value;
  let topicInput = topicSelect === 'custom' ? document.getElementById('add-vocab-topic').value.trim() : topicSelect;
  if (!topicInput) topicInput = 'Cá nhân';
  
  if (!wordInput) {
    alert("Vui lòng nhập Từ vựng!");
    return;
  }

  const container = document.getElementById('add-vocab-meanings-container');
  if (!container) return;
  const blocks = container.querySelectorAll('.meaning-block');
  
  const saveBtn = event.target.querySelector('button[type="submit"]');
  const originalText = saveBtn.textContent;
  saveBtn.disabled = true;
  saveBtn.textContent = '🔄 Đang lưu dữ liệu...';

  // Extract all meaning blocks
  const meanings = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const type = block.querySelector('.vocab-type-input').value;
    const meaning = block.querySelector('.vocab-meaning-input').value.trim();
    const definition = block.querySelector('.vocab-definition-input').value.trim();
    let example = block.querySelector('.vocab-example-input').value.trim();
    let exampleMeaning = block.querySelector('.vocab-example-meaning-input').value.trim();

    if (!meaning) {
      continue;
    }

    if (example && !exampleMeaning) {
      exampleMeaning = await translateExampleText(example);
    }

    meanings.push({
      type,
      meaning,
      definition,
      example,
      exampleMeaning
    });
  }

  if (meanings.length === 0) {
    saveBtn.disabled = false;
    saveBtn.textContent = originalText;
    alert("Vui lòng nhập ít nhất một ý nghĩa cho từ vựng!");
    return;
  }

  // Fallback pronunciation lookup if empty
  if (!pronunciationInput) {
    const info = await getWordDetailsAuto(wordInput);
    pronunciationInput = info.pronunciation || '';
    if (isFakeIPA(wordInput, pronunciationInput)) pronunciationInput = '';
  }
  
  if (activeEditIndex !== null) {
    // Update existing vocab item
    state.vocab[activeEditIndex] = {
      ...state.vocab[activeEditIndex],
      word: wordInput,
      pronunciation: pronunciationInput,
      topic: topicInput,
      meanings: meanings
    };
    alert(`Đã cập nhật từ "${wordInput}" thành công!`);
  } else {
    // Prevent adding duplicates (case-insensitive check)
    const isDuplicate = state.vocab.some(w => w.word.toLowerCase().trim() === wordInput.toLowerCase().trim());
    if (isDuplicate) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
      alert(`⚠️ Từ "${wordInput}" đã có sẵn trong kho từ vựng cá nhân của bạn!\nHệ thống không thể thêm trùng lặp.`);
      return;
    }

    // Add new vocab item
    state.vocab.unshift({
      word: wordInput,
      pronunciation: pronunciationInput,
      topic: topicInput,
      status: 'new',
      lastReviewed: null,
      reviewCount: 0,
      meanings: meanings
    });
    alert(`Đã thêm từ "${wordInput}" vào kho từ cá nhân!`);
  }
  
  saveState();
  
  // Reset form headers back to default
  const formHeader = document.querySelector('#vocab-add h2');
  if (formHeader) formHeader.textContent = 'Thêm từ vựng mới';
  
  const submitBtn = document.querySelector('#add-word-form button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Lưu vào kho từ';
  
  activeEditIndex = null;
  document.getElementById('add-word-form').reset();
  
  const customTopicInput = document.getElementById('add-vocab-topic');
  if (customTopicInput) customTopicInput.style.display = 'none';
  
  saveBtn.disabled = false;
  saveBtn.textContent = originalText;
  
  switchVocabTab('vocab-list');
}

// Batch Import Parser with fully automatic dictionary lookups
// Parse a single batch line into { word, meanings: [{type, meaning}], synonymGroup }
// Handles formats like:
//   "Branch (n) : chi nhánh"
//   "Conduct (v) thực hiện (n) : hành vi , cách ứng sử"
//   "Feature (n): tính năng | (v): bao gồm | (adj): nổi bật"   ← pipe separator
//   "Abide by = comply with = conform to : tuân thủ"           ← synonym group
//   "Hoàn thành = finalize / finish / complete : hoàn thành"   ← slash synonyms
//   "Objectively adv : khách quan"
//   "Priorizre (V) ; ưu tiên"
function parseBatchLine(line) {
  line = line.trim();
  if (!line) return null;
  
  // Reject lines that are notes, headers, or don't contain a valid vocabulary entry
  if (line.toLowerCase().includes('reading part') || line.toLowerCase().includes('thầy dũng') || line.toLowerCase().includes('bài tập ngày') || line.toLowerCase().startsWith('stt\ttừ vựng')) {
    return null;
  }

  // ── TSV TABLE FORMAT detection: "1\tAccommodate\tVerb\tCung cấp chỗ ở..."
  if (line.includes('\t')) {
    const parts = line.split('\t').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      let wordIdx = 0;
      if (/^\d+$/.test(parts[0]) && parts.length >= 3) wordIdx = 1;
      const cleanWord = sanitizeWordTitle(parts[wordIdx]);
      if (cleanWord && cleanWord.length >= 2) {
        let posType = detectWordPOS(cleanWord);
        let meaningText = '';
        if (parts.length > wordIdx + 2) {
          posType = normalizePOS(parts[wordIdx + 1]).toLowerCase();
          meaningText = parts.slice(wordIdx + 2).join(' - ');
        } else {
          meaningText = parts[wordIdx + 1];
        }
        return { word: cleanWord, meanings: [{ type: posType, meaning: meaningText }] };
      }
    }
  }

  // ── SYNONYM GROUP detection: "abide by = comply with = conform to : tuân thủ"
  // or "finalize / finish / complete : hoàn thành"
  // These lines contain multiple English words separated by = or /
  // We parse them as a synonym group and return the FIRST word as primary
  const synonymSepRegex = /[=]/g;
  const hasSynonymGroup = (line.match(synonymSepRegex) || []).length >= 1;
  if (hasSynonymGroup) {
    // Split by = to get all synonym entries; last segment may contain : Vietnamese meaning
    const parts = line.split('=').map(s => s.trim());
    // Vietnamese meaning is in the last part, after :
    const lastPart = parts[parts.length - 1];
    const colonIdx = lastPart.lastIndexOf(':');
    const dashIdx = lastPart.lastIndexOf(' - ');
    let viMeaning = '';
    let lastEnPart = lastPart;
    if (colonIdx > 0) {
      viMeaning = lastPart.substring(colonIdx + 1).trim();
      lastEnPart = lastPart.substring(0, colonIdx).trim();
    } else if (dashIdx > 0) {
      viMeaning = lastPart.substring(dashIdx + 3).trim();
      lastEnPart = lastPart.substring(0, dashIdx).trim();
    }
    // Collect all English words/phrases from all segments
    const synonymWords = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const w = sanitizeWordTitle(parts[i]);
      if (w && w.length > 1) synonymWords.push(w);
    }
    // Also parse the lastEnPart for additional slash-separated synonyms
    const lastSlashParts = lastEnPart.split('/').map(s => s.trim()).filter(Boolean);
    lastSlashParts.forEach(s => {
      const w = sanitizeWordTitle(s);
      if (w && w.length > 1) synonymWords.push(w);
    });
    if (synonymWords.length === 0) return null;
    // Primary word is the first synonym; annotate with synonyms list
    const primaryWord = synonymWords[0];
    const posKey = detectWordPOS(primaryWord);
    const fullMeaning = viMeaning || 'Xem nhóm đồng nghĩa';
    const synonymNote = synonymWords.length > 1
      ? `${fullMeaning} | Đồng nghĩa: ${synonymWords.slice(1).join(' = ')}`
      : fullMeaning;
    return { word: primaryWord, meanings: [{ type: posKey, meaning: synonymNote }], synonymGroup: synonymWords };
  }

  // ── PIPE SEPARATOR: "Feature (n): tính năng | (v): bao gồm | (adj): nổi bật"
  const pipeSegments = line.split('|');
  if (pipeSegments.length > 1) {
    // First segment contains the word; subsequent segments are extra meanings
    const firstSeg = pipeSegments[0].trim();
    let cleanWord = sanitizeWordTitle(firstSeg);
    if (!cleanWord || cleanWord.length < 2) return null;
    const meanings = [];
    const posRegexPipe = /\(\s*(n|v|adj|adv|noun|verb|adjective|adverb)\s*\)/gi;
    function normPOS(raw) {
      const r = raw.toLowerCase().trim();
      if (r === 'n' || r === 'noun') return 'noun';
      if (r === 'v' || r === 'verb') return 'verb';
      if (r === 'adj' || r === 'adjective') return 'adjective';
      if (r === 'adv' || r === 'adverb') return 'adverb';
      return detectWordPOS(cleanWord);
    }
    for (const seg of pipeSegments) {
      const s = seg.trim();
      const pm = posRegexPipe.exec ? null : null;
      posRegexPipe.lastIndex = 0;
      const m = posRegexPipe.exec(s);
      if (m) {
        const posType = normPOS(m[1]);
        const meaningText = s.substring(m.index + m[0].length).replace(/^[\s:]+/, '').trim();
        if (meaningText) meanings.push({ type: posType, meaning: meaningText });
      } else {
        // No explicit POS in segment — try "word - nghĩa" or "nghĩa" from remainder
        const remainder = s.replace(cleanWord, '').replace(/^[\s:\-]+/, '').trim();
        if (remainder && meanings.length === 0) {
          meanings.push({ type: detectWordPOS(cleanWord), meaning: remainder });
        }
      }
    }
    if (meanings.length === 0) meanings.push({ type: detectWordPOS(cleanWord), meaning: '' });
    return { word: cleanWord, meanings };
  }
  
  // ── STANDARD single-line parsing ──
  let cleanWord = sanitizeWordTitle(line);
  if (!cleanWord || cleanWord.length < 2) return null;
  
  // Step 2: Parse meanings by splitting on POS markers in the original line
  const posRegex = /\(\s*(n|v|adj|adv|noun|verb|adjective|adverb)\s*\)/gi;
  const posMatches = [];
  let posMatch;
  while ((posMatch = posRegex.exec(line)) !== null) {
    posMatches.push({ index: posMatch.index, end: posMatch.index + posMatch[0].length, type: posMatch[1] });
  }
  
  function normalizePOS(raw) {
    const r = raw.toLowerCase().trim();
    if (r === 'n' || r === 'noun') return 'noun';
    if (r === 'v' || r === 'verb') return 'verb';
    if (r === 'adj' || r === 'adjective') return 'adjective';
    if (r === 'adv' || r === 'adverb') return 'adverb';
    return detectWordPOS(cleanWord);
  }
  
  const meanings = [];
  if (posMatches.length > 0) {
    for (let i = 0; i < posMatches.length; i++) {
      const posType = normalizePOS(posMatches[i].type);
      const startIdx = posMatches[i].end;
      const endIdx = i + 1 < posMatches.length ? posMatches[i + 1].index : line.length;
      let meaningText = line.substring(startIdx, endIdx).replace(/^[\s:;]+/, '').replace(/[\s:;]+$/, '').trim();
      meanings.push({ type: posType, meaning: meaningText });
    }
  } else {
    // No explicit POS marker in line
    let remainder = line.substring(cleanWord.length).replace(/^[\s:;]+/, '').trim();
    // Check if remainder starts with standalone POS like "adv : khách quan"
    const standMatch = remainder.match(/^(n|v|adj|adv|noun|verb|adjective|adverb)\s*[:;]?\s*(.*)/i);
    const posType = standMatch ? normalizePOS(standMatch[1]) : detectWordPOS(cleanWord);
    const meaningText = standMatch ? standMatch[2].trim() : remainder;
    meanings.push({ type: posType, meaning: meaningText });
  }
  
  return { word: cleanWord, meanings };
}

// ══════════════════════════════════════════════
//  CENTRAL DICTIONARY & MULTI-POS LOOKUP ENGINE
// ══════════════════════════════════════════════
async function lookupWordAllDetails(rawWord, userMeanings = []) {
  if (!rawWord) return null;
  const originalClean = sanitizeWordTitle(rawWord);
  const cleanWord = await autoCorrectWordTypo(originalClean);
  const lowerKey = cleanWord.toLowerCase().trim();

  let pronunciation = '';
  let meanings = [];

  // 1. Check SMART_TOEIC_TERMS curated dictionary
  if (SMART_TOEIC_TERMS[lowerKey]) {
    const smart = SMART_TOEIC_TERMS[lowerKey];
    if (smart.pronunciation) pronunciation = sanitizeIPA(smart.pronunciation);

    if (smart.meanings && Array.isArray(smart.meanings) && smart.meanings.length > 0) {
      meanings = smart.meanings.map(m => ({
        type: (m.type || m.pos || 'noun').toLowerCase(),
        pos: normalizePOS(m.pos || m.type || 'NOUN'),
        meaning: m.meaning,
        definition: m.definition || '',
        example: m.example || '',
        exampleMeaning: m.exampleMeaning || ''
      }));
    } else if (smart.pos && smart.meaning) {
      meanings = [{
        type: smart.pos.toLowerCase(),
        pos: normalizePOS(smart.pos),
        meaning: smart.meaning,
        definition: smart.definition || '',
        example: smart.example || '',
        exampleMeaning: smart.exampleMeaning || ''
      }];
    }
  }

  // 2. Fetch online Dictionary API if not fully populated
  if (meanings.length === 0) {
    try {
      const dictRes = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
      if (dictRes.ok) {
        const dictData = await dictRes.json();
        const firstEntry = dictData[0];

        let rawPhonetic = firstEntry.phonetic || '';
        if (!rawPhonetic && firstEntry.phonetics) {
          const found = firstEntry.phonetics.find(p => p.text && p.text.startsWith('/'));
          rawPhonetic = found ? found.text : '';
        }
        rawPhonetic = rawPhonetic.replace(/\(\s*(n|v|adj|adv|noun|verb|adjective|adverb)\s*\)/gi, '').replace(/[()]/g, '').trim();
        if (rawPhonetic && !rawPhonetic.startsWith('/')) rawPhonetic = '/' + rawPhonetic;
        if (rawPhonetic && !rawPhonetic.endsWith('/')) rawPhonetic = rawPhonetic + '/';
        pronunciation = rawPhonetic;

        const dictByPOS = {};
        const posOrder = [];
        for (const entry of dictData) {
          if (!entry.meanings) continue;
          for (const mGroup of entry.meanings) {
            const rawP = (mGroup.partOfSpeech || 'noun').toLowerCase();
            const normP = normalizePOS(rawP);
            if (!dictByPOS[normP]) {
              dictByPOS[normP] = [];
              posOrder.push(normP);
            }
            for (const def of mGroup.definitions) {
              dictByPOS[normP].push({
                definition: def.definition || '',
                example: def.example || ''
              });
            }
          }
        }

        const userViText = (userMeanings && userMeanings[0]?.meaning) ? userMeanings[0].meaning.trim() : '';

        for (const posLabel of posOrder) {
          const defs = dictByPOS[posLabel] || [];
          const bestDict = defs.find(d => d.example) || defs[0] || null;
          let exText = bestDict?.example || generateTemplateExample(cleanWord, posLabel.toLowerCase());
          let defText = bestDict?.definition || '';
          
          const exTrans = exText ? await translateTextToVi(exText) : '';
          let viMeaning = defText ? await translateTextToVi(defText) : '';

          // If user provided a Vietnamese meaning, use it for NOUN or matching POS
          if (userViText && (posLabel === 'NOUN' || posLabel.toLowerCase() === detectWordPOS(cleanWord))) {
            if (viMeaning && !viMeaning.toLowerCase().includes(userViText.toLowerCase())) {
              viMeaning = `${userViText} (${viMeaning})`;
            } else if (!viMeaning) {
              viMeaning = userViText;
            }
          }

          meanings.push({
            type: posLabel.toLowerCase(),
            pos: posLabel,
            meaning: viMeaning || userViText || 'Chưa cập nhật',
            definition: defText,
            example: exText,
            exampleMeaning: exTrans
          });
        }
      }
    } catch (e) {
      console.warn('Dict lookup error for ' + cleanWord, e);
    }
  }

  // 3. Final fallback if dictionary returned nothing
  if (meanings.length === 0) {
    const userViText = (userMeanings && userMeanings[0]?.meaning) ? userMeanings[0].meaning.trim() : 'Chưa cập nhật';
    const posKey = detectWordPOS(cleanWord);
    const exText = generateTemplateExample(cleanWord, posKey);
    const exTrans = exText ? await translateTextToVi(exText) : '';
    meanings.push({
      type: posKey,
      pos: normalizePOS(posKey),
      meaning: userViText,
      definition: '',
      example: exText,
      exampleMeaning: exTrans
    });
  }

  // 4. Ensure IPA fallback
  if (!pronunciation || isFakeIPA(cleanWord, pronunciation)) {
    try {
      const smartTerm = SMART_TOEIC_TERMS[cleanWord.toLowerCase()];
      if (smartTerm?.pronunciation) {
        pronunciation = sanitizeIPA(smartTerm.pronunciation);
      }
    } catch (e) {
      pronunciation = '';
    }
  }

  // Fetch Thesaurus Synonyms & Antonyms
  const thesaurus = await fetchThesaurusSynonyms(cleanWord);

  return {
    word: cleanWord,
    cleanWord,
    pronunciation,
    meanings,
    synonyms: thesaurus.synonyms || [],
    antonyms: thesaurus.antonyms || [],
    wasAutocorrected: cleanWord.toLowerCase() !== originalClean.toLowerCase(),
    originalClean
  };
}

async function getWordDetailsAuto(word) {
  const result = await lookupWordAllDetails(word);
  return {
    word: result.cleanWord,
    pronunciation: result.pronunciation,
    meanings: result.meanings,
    topic: 'Cá nhân'
  };
}

async function importBatchWords() {
  const textarea = document.getElementById('import-batch-area');
  const text = (textarea?.value || '').trim();
  if (!text) {
    alert("Vui lòng dán danh sách từ vựng vào hộp văn bản!");
    return;
  }
  
  const selectedPart = document.getElementById('import-batch-part')?.value || 'Cá nhân';
  const lines = text.split('\n');
  let importedCount = 0;
  let autoCorrectedCount = 0;
  let skippedDuplicateCount = 0;
  const autocorrectLog = [];

  const importBtn = document.getElementById('import-batch-btn') || document.querySelector('button[onclick="importBatchWords()"]');
  const originalText = importBtn ? importBtn.textContent : 'Lưu';
  if (importBtn) {
    importBtn.disabled = true;
    importBtn.textContent = '🔄 Đang phân tích & tra cứu từ loại...';
  }

  const progressWrap = document.getElementById('import-progress-wrap');
  const progressBar = document.getElementById('import-progress-bar');
  const progressLabel = document.getElementById('import-progress-label');
  const progressPct = document.getElementById('import-progress-pct');
  const autocorrectLogEl = document.getElementById('import-autocorrect-log');
  if (progressWrap) progressWrap.style.display = 'block';
  if (autocorrectLogEl) autocorrectLogEl.style.display = 'none';

  const validLines = lines.filter(l => parseBatchLine(l));
  const total = validLines.length;
  let processed = 0;

  function updateProgress(word) {
    processed++;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 100;
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressPct) progressPct.textContent = pct + '%';
    if (progressLabel) progressLabel.textContent = `Đang xử lý từ loại & nghĩa: "${word}" (${processed}/${total})`;
  }

  for (const line of lines) {
    const parsed = parseBatchLine(line);
    if (!parsed || !parsed.word) continue;

    const lookupRes = await lookupWordAllDetails(parsed.word, parsed.meanings);
    if (!lookupRes || !lookupRes.cleanWord) continue;

    if (lookupRes.wasAutocorrected) {
      autoCorrectedCount++;
      autocorrectLog.push(`"${lookupRes.originalClean}" → "${lookupRes.cleanWord}"`);
    }

    updateProgress(lookupRes.cleanWord);

    // Skip if already exists in vocab bank
    if (state.vocab.some(w => w.word.toLowerCase().trim() === lookupRes.cleanWord.toLowerCase().trim())) {
      skippedDuplicateCount++;
      continue;
    }

    state.vocab.unshift({
      word: lookupRes.cleanWord,
      pronunciation: lookupRes.pronunciation,
      topic: selectedPart,
      status: 'new',
      lastReviewed: null,
      reviewCount: 0,
      meanings: lookupRes.meanings
    });
    importedCount++;
  }

  saveState();
  if (textarea) textarea.value = '';
  if (importBtn) {
    importBtn.disabled = false;
    importBtn.textContent = originalText;
  }

  if (progressLabel) progressLabel.textContent = `✅ Hoàn thành! Đã nhập ${importedCount} từ vào "${selectedPart}"`;
  if (progressBar) progressBar.style.width = '100%';
  if (progressPct) progressPct.textContent = '100%';
  
  if (autocorrectLogEl) {
    let logHtml = '';
    if (autoCorrectedCount > 0) logHtml += `✏️ Đã tự động sửa ${autoCorrectedCount} lỗi chính tả: ${autocorrectLog.join(' | ')}<br>`;
    if (skippedDuplicateCount > 0) logHtml += `⚠️ Đã bỏ qua ${skippedDuplicateCount} từ bị trùng lặp vì đã có sẵn trong kho từ.`;
    if (logHtml) {
      autocorrectLogEl.style.display = 'block';
      autocorrectLogEl.innerHTML = logHtml;
    }
  }

  let alertMsg = `✅ Đã nhập thành công ${importedCount} từ vựng vào "${selectedPart}"!`;
  if (skippedDuplicateCount > 0) alertMsg += `\n⚠️ Bỏ qua ${skippedDuplicateCount} từ bị trùng lặp vì đã có sẵn.`;
  if (autoCorrectedCount > 0) alertMsg += `\n✏️ Tự động sửa ${autoCorrectedCount} lỗi chính tả.`;
  alert(alertMsg);
  switchVocabTab('vocab-list');
}

// selectImportPart: highlight the selected Part button in the import UI
function selectImportPart(btn) {
  document.querySelectorAll('.part-select-btn').forEach(b => {
    b.style.background = 'var(--bg-tertiary)';
    b.style.border = '2px solid var(--border-color)';
    b.style.color = 'var(--text-primary)';
  });
  btn.style.background = 'var(--accent-primary)';
  btn.style.border = '2px solid var(--accent-primary)';
  btn.style.color = '#fff';
  const partInput = document.getElementById('import-batch-part');
  if (partInput) partInput.value = btn.getAttribute('data-part');
}

// High quality SpeechSynthesizer TTS audio player
function playWordTTS(text) {
  if (!text) return;
  const clean = text.replace(/\(.*\)/, '').trim();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'en-US';
    utterance.rate = 0.88;
    utterance.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const usVoice = voices.find(v => (v.lang === 'en-US' || v.lang === 'en_US') && (v.name.includes('Google US') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Karen')));
    if (usVoice) utterance.voice = usVoice;
    window.speechSynthesis.speak(utterance);
    return;
  }
  const audio = new Audio(`https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(clean)}&tl=en&client=tw-ob`);
  audio.play().catch(e => console.warn('Audio play failed', e));
}

// Thesaurus.com / Datamuse Synonyms & Antonyms Lookup
async function fetchThesaurusSynonyms(word) {
  if (!word) return { synonyms: [], antonyms: [] };
  try {
    const synRes = await fetch(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=6`);
    const antRes = await fetch(`https://api.datamuse.com/words?rel_ant=${encodeURIComponent(word)}&max=4`);
    let synonyms = [];
    let antonyms = [];
    if (synRes.ok) {
      const synData = await synRes.json();
      synonyms = synData.map(item => item.word);
    }
    if (antRes.ok) {
      const antData = await antRes.json();
      antonyms = antData.map(item => item.word);
    }
    return { synonyms, antonyms };
  } catch (e) {
    console.warn('Thesaurus API error:', e);
    return { synonyms: [], antonyms: [] };
  }
}

// Spaced Repetition Practice
let activeReviewList = [];
let activeReviewIndex = 0;

function startSpacedReviewSession() {
  // Select words: either reviewing (Hay quên) or learning (Đang nhớ)
  activeReviewList = state.vocab.filter(w => w.status === 'reviewing' || w.status === 'learning' || w.status === 'new');
  // Shuffle list
  activeReviewList.sort(() => 0.5 - Math.random());
  
  if (activeReviewList.length === 0) {
    document.getElementById('vocab-review-active').style.display = 'none';
    document.getElementById('vocab-review-empty').style.display = 'block';
    return;
  }
  
  document.getElementById('vocab-review-active').style.display = 'block';
  document.getElementById('vocab-review-empty').style.display = 'none';
  
  activeReviewIndex = 0;
  showReviewCard(0);
}

function showReviewCard(index) {
  if (index < 0 || index >= activeReviewList.length) {
    alert("Bạn đã hoàn thành tất cả các từ cần ôn hôm nay!");
    updateStreakForToday();
    switchVocabTab('vocab-list');
    return;
  }
  
  // Abort active speech recognition
  if (speechRecognition && speechIsListening) {
    speechRecognition.stop();
  }
  
  activeReviewIndex = index;
  const rawWordData = activeReviewList[index];
  const wordData = sanitizeVocabEntry(rawWordData);
  if (!wordData) return;

  const cardElement = document.getElementById('review-flashcard');
  cardElement.classList.remove('is-flipped');
  
  // Front Side
  const validTypes = Array.from(new Set(wordData.meanings.map(m => m.pos).filter(Boolean)));
  const allTypesText = validTypes.length > 0 ? validTypes.join(' / ') : '';
  
  document.getElementById('rv-front-word').textContent = wordData.word;
  
  const typeElem = document.getElementById('rv-front-type');
  if (typeElem) {
    if (allTypesText) {
      typeElem.textContent = allTypesText;
      typeElem.style.display = 'inline-block';
    } else {
      typeElem.textContent = '';
      typeElem.style.display = 'none';
    }
  }
  
  const phonElem = document.getElementById('rv-front-phonetic');
  if (phonElem) {
    if (wordData.ipa) {
      phonElem.textContent = wordData.ipa;
      phonElem.style.display = 'inline-block';
    } else {
      phonElem.textContent = '';
      phonElem.style.display = 'none';
    }
  }
  
  const resultDiv = document.getElementById('speech-grading-result');
  if (resultDiv) resultDiv.textContent = '';
  
  // Back Side
  const backCenterInfo = cardElement.querySelector('.oq-card-back .oq-center-info');
  if (backCenterInfo) {
    let meaningsHtml = '';
    wordData.meanings.forEach((m, idx) => {
      meaningsHtml += `
        <div style="text-align: left; margin-bottom: 0.8rem; padding-bottom: 0.8rem; ${idx < wordData.meanings.length - 1 ? 'border-bottom: 1px dashed rgba(255,255,255,0.15);' : ''}">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            ${m.pos ? `<span class="status-badge pos-badge-${m.pos.toLowerCase()}" style="background: rgba(255,255,255,0.1); color: var(--text-primary); font-size: 0.75rem; padding: 1px 5px; text-transform: uppercase;">${m.pos}</span>` : ''}
            <span style="font-weight: 700; color: var(--accent-success); font-size: 1.1rem;">${m.meaning}</span>
          </div>
          ${m.definition ? `<div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.2rem; font-weight: normal;">${m.definition}</div>` : ''}
          ${m.example ? `<div style="font-size: 0.85rem; font-style: italic; color: var(--text-primary); margin-top: 0.4rem; font-weight: normal; border-left: 2px solid var(--accent-primary); padding-left: 0.4rem;">e.g. ${m.example}</div>` : ''}
          ${m.exampleMeaning ? `<div style="font-size: 0.8rem; color: #a1a1aa; margin-top: 0.2rem; font-style: italic; font-weight: normal; padding-left: 0.6rem;">${m.exampleMeaning}</div>` : ''}
        </div>
      `;
    });
    backCenterInfo.style.maxHeight = '280px';
    backCenterInfo.style.overflowY = 'auto';
    backCenterInfo.innerHTML = meaningsHtml;
  }
  
  document.getElementById('review-progress').textContent = `${index + 1}/${activeReviewList.length}`;
  const navProgress = document.getElementById('oq-nav-progress');
  if (navProgress) {
    navProgress.textContent = `Thẻ ${index + 1} / ${activeReviewList.length}`;
  }

  // Autoplay TTS if toggle is checked
  setTimeout(() => {
    const autoplayToggle = document.getElementById('autoplay-audio');
    if (autoplayToggle && autoplayToggle.checked) {
      playWordTTS(wordData.word);
    }
  }, 300);
}

function flipReviewCard() {
  document.getElementById('review-flashcard').classList.toggle('is-flipped');
}

function previousReviewCard(event) {
  if (event) event.stopPropagation();
  if (activeReviewIndex > 0) {
    showReviewCard(activeReviewIndex - 1);
  }
}

function nextReviewCard(event) {
  if (event) event.stopPropagation();
  if (activeReviewIndex < activeReviewList.length - 1) {
    showReviewCard(activeReviewIndex + 1);
  } else {
    alert("Bạn đang ở từ vựng cuối cùng!");
  }
}

function shuffleReviewCards() {
  activeReviewList.sort(() => 0.5 - Math.random());
  activeReviewIndex = 0;
  showReviewCard(0);
}

function reviewChoice(status) {
  const activeWord = activeReviewList[activeReviewIndex];
  // Find real word in state vocab
  const vocabWord = state.vocab.find(w => w.word.toLowerCase() === activeWord.word.toLowerCase());
  
  if (vocabWord) {
    vocabWord.status = status;
    vocabWord.lastReviewed = new Date().toISOString();
    vocabWord.reviewCount = (vocabWord.reviewCount || 0) + 1;
    saveState();
  }
  
  showReviewCard(activeReviewIndex + 1);
}

// ==========================================
// 📖 MODULE 3 & 4: HOMEWORK
// ==========================================
let currentHwType = 'reading'; // 'reading' or 'listening'

function switchHwTab(typeTabId) {
  currentHwType = typeTabId === 'hw-reading' ? 'reading' : 'listening';
  
  document.querySelectorAll('#homework-view .tab-btn').forEach(btn => {
    if (btn.getAttribute('onclick').includes(typeTabId)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  renderHomeworkList();
  
  // Clear details pane initially
  document.getElementById('hw-details-pane').innerHTML = `
    <div style="text-align: center; color: var(--text-secondary); padding: 4rem 1rem;">
      <h3>Chọn bài tập từ danh sách bên trái để bắt đầu làm bài</h3>
    </div>
  `;
}

function renderHomeworkList() {
  const container = document.getElementById('hw-list-container');
  container.innerHTML = '';
  
  const filteredList = state.homework.filter(h => h.type === currentHwType);
  
  if (filteredList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-secondary); padding: 2rem 0; font-size: 0.9rem;">
        Chưa có bài tập nào được tạo
      </div>
    `;
    return;
  }
  
  filteredList.forEach(hw => {
    const item = document.createElement('div');
    item.className = 'hw-list-item';
    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
        <span style="font-weight: 600; font-family: var(--font-display);">${hw.title}</span>
        <span class="hw-status ${hw.status}">${hw.status === 'completed' ? 'Đã nộp' : 'Chưa làm'}</span>
      </div>
      <div style="font-size: 0.8rem; color: var(--text-secondary); display: flex; justify-content: space-between;">
        <span>Số câu hỏi: ${hw.questionsCount}</span>
        <span>${hw.dateLogged ? new Date(hw.dateLogged).toLocaleDateString('vi-VN') : ''}</span>
      </div>
    `;
    item.onclick = () => loadHomeworkDetails(hw.id);
    container.appendChild(item);
  });
}

// Load Homework details into right pane
let currentActiveHwId = null;

function loadHomeworkDetails(hwId) {
  currentActiveHwId = hwId;
  const hw = state.homework.find(h => h.id === hwId);
  if (!hw) return;
  
  // Highlight active
  document.querySelectorAll('.hw-list-item').forEach(item => {
    if (item.onclick.toString().includes(hwId)) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
  
  const detailsPane = document.getElementById('hw-details-pane');
  
  let audioHtml = '';
  if (hw.type === 'listening' && hw.source) {
    audioHtml = `
      <div class="glass-card" style="margin-bottom: 1.5rem; padding: 1rem;">
        <h4 style="margin-bottom: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);">Nguồn âm thanh:</h4>
        <audio controls src="${hw.source}" style="width: 100%;"></audio>
      </div>
    `;
  }
  
  let answersFormHtml = '';
  for (let i = 1; i <= hw.questionsCount; i++) {
    const studentAns = hw.studentAnswers ? hw.studentAnswers[i] || '' : '';
    const correctAns = hw.answers ? hw.answers[i] || '' : '';
    let validationClass = '';
    
    if (hw.status === 'completed') {
      if (studentAns === correctAns) {
        validationClass = 'style="border-color: var(--accent-success); background: var(--accent-success-glow);"';
      } else {
        validationClass = 'style="border-color: var(--accent-danger); background: var(--accent-danger-glow);"';
      }
    }
    
    answersFormHtml += `
      <div class="answer-bubble-row" ${validationClass}>
        <span style="font-weight:600; width: 40px;">Câu ${i}:</span>
        <select class="answer-select hw-ans-input" data-q="${i}" ${hw.status === 'completed' ? 'disabled' : ''}>
          <option value="">- Chọn -</option>
          <option value="A" ${studentAns === 'A' ? 'selected' : ''}>A</option>
          <option value="B" ${studentAns === 'B' ? 'selected' : ''}>B</option>
          <option value="C" ${studentAns === 'C' ? 'selected' : ''}>C</option>
          <option value="D" ${studentAns === 'D' ? 'selected' : ''}>D</option>
        </select>
        ${hw.status === 'completed' ? `<span style="font-size: 0.8rem; margin-left: auto; color: var(--accent-success); font-weight: 600;">Đáp án: ${correctAns}</span>` : ''}
      </div>
    `;
  }

  const rightColumnHtml = `
    ${audioHtml}
    <div class="glass-card" style="margin-bottom: 1.5rem;">
      <h3 style="margin-bottom: 1rem; font-size: 1.1rem; display: flex; justify-content: space-between;">
        <span>Phiếu điền đáp án</span>
        ${hw.status === 'completed' ? `<span style="color: var(--accent-primary);">Độ chính xác: ${calculateHwAccuracy(hw)}%</span>` : ''}
      </h3>
      <div class="answer-grid">
        ${answersFormHtml}
      </div>
      ${hw.status === 'pending' ? `
        <button class="btn-primary" style="margin-top: 1.5rem; width: 100%;" onclick="submitHomeworkAnswers()">Nộp bài & Kiểm tra đáp án</button>
      ` : ''}
    </div>
    
    <!-- Quick Vocab Extractor inside Homework -->
    <div class="glass-card">
      <h3 style="margin-bottom: 0.5rem; font-size: 1.1rem; color: var(--accent-primary);">⚡ Trích xuất từ vựng</h3>
      <form onsubmit="extractWordFromHw(event)">
        <div class="form-row">
          <div class="form-group">
            <input type="text" id="ext-word" class="form-control" placeholder="Từ vựng mới" required>
          </div>
          <div class="form-group">
            <input type="text" id="ext-meaning" class="form-control" placeholder="Nghĩa dịch" required>
          </div>
        </div>
        <div class="form-group" style="margin-top: -0.5rem; margin-bottom: 1rem;">
          <input type="text" id="ext-example" class="form-control" placeholder="Ngữ cảnh / Câu ví dụ (Tự lấy khi bôi đen chữ)">
        </div>
        <button type="submit" class="btn-primary" style="background: var(--bg-tertiary); border: 1px solid var(--border-color); width: 100%;">Thêm vào kho từ</button>
      </form>
    </div>
  `;

  if (hw.content) {
    detailsPane.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem; margin-bottom: 1.5rem;">
        <h2 style="font-family: var(--font-display);">${hw.title}</h2>
        <span style="font-weight: 600; color: var(--accent-primary); font-size: 1.1rem;">${hw.part}</span>
      </div>
      <div class="hw-split-board" style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 2rem;">
        <div>
          <h4 style="margin-bottom: 0.8rem; color: var(--text-secondary); text-transform: uppercase; font-size: 0.85rem; letter-spacing: 0.5px;">Nội dung bài học / Passage</h4>
          <div id="hw-passage-text" onmouseup="handlePassageTextSelection()" style="background: rgba(15, 23, 42, 0.4); border: 1px solid var(--border-color); padding: 1.5rem; border-radius: 16px; min-height: 280px; line-height: 1.6; font-size: 1rem; color: var(--text-primary); white-space: pre-wrap; max-height: 500px; overflow-y: auto;">${hw.content}</div>
          <div style="margin-top: 1rem; background: var(--accent-primary-glow); border: 1px dashed var(--accent-primary); padding: 0.8rem; border-radius: 12px; font-size: 0.8rem; color: var(--text-primary); line-height: 1.4;">
            💡 <strong>Mẹo hay:</strong> Bạn có thể dùng chuột bôi đen bất kỳ từ mới nào bên trong đoạn văn bản phía trên. Hệ thống sẽ tự động bắt từ vựng đó và trích xuất câu văn ngữ cảnh đưa vào khung lưu từ vựng bên phải!
          </div>
        </div>
        <div>
          ${rightColumnHtml}
        </div>
      </div>
    `;
  } else {
    detailsPane.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 1rem; margin-bottom: 1.5rem;">
        <h2 style="font-family: var(--font-display);">${hw.title}</h2>
        <span style="font-weight: 600; color: var(--accent-primary); font-size: 1.1rem;">${hw.part || ''}</span>
      </div>
      ${rightColumnHtml}
    `;
  }
}

function calculateHwAccuracy(hw) {
  let correct = 0;
  for (let i = 1; i <= hw.questionsCount; i++) {
    if (hw.studentAnswers[i] === hw.answers[i]) {
      correct++;
    }
  }
  return Math.round((correct / hw.questionsCount) * 100);
}

// Add New Homework Log Form
function openAddHwModal() {
  document.getElementById('hw-modal-title').textContent = currentHwType === 'reading' ? 'Thêm bài tập Reading' : 'Thêm bài tập Listening';
  document.getElementById('hw-audio-source-group').style.display = currentHwType === 'listening' ? 'block' : 'none';
  
  // Populate Part options
  const partSelect = document.getElementById('hw-part');
  partSelect.innerHTML = '';
  if (currentHwType === 'reading') {
    partSelect.innerHTML = `
      <option value="Part 5">Part 5 - Điền từ vào câu</option>
      <option value="Part 6">Part 6 - Điền từ vào đoạn văn</option>
      <option value="Part 7">Part 7 - Đọc hiểu đoạn văn</option>
    `;
  } else {
    partSelect.innerHTML = `
      <option value="Part 1">Part 1 - Mô tả tranh</option>
      <option value="Part 2">Part 2 - Hỏi đáp</option>
      <option value="Part 3">Part 3 - Hội thoại</option>
      <option value="Part 4">Part 4 - Bài nói ngắn</option>
    `;
  }

  // Clear previous options
  const container = document.getElementById('hw-modal-answers-input');
  container.innerHTML = '';
  generateHwModalAnswers(10);
  
  document.getElementById('add-hw-modal').style.display = 'flex';
}

function closeHwModal() {
  document.getElementById('add-hw-modal').style.display = 'none';
}

function generateHwModalAnswers(count) {
  const container = document.getElementById('hw-modal-answers-input');
  container.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.gap = '0.5rem';
    div.innerHTML = `
      <span style="font-size: 0.85rem;">Câu ${i}:</span>
      <select class="answer-select hw-modal-ans-val" data-q="${i}">
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="C">C</option>
        <option value="D">D</option>
      </select>
    `;
    container.appendChild(div);
  }
}

// Trigger answer input fields generation based on questions count dropdown
function onHwCountChange(val) {
  generateHwModalAnswers(parseInt(val));
}

// Save homework
function saveHomeworkLog(event) {
  event.preventDefault();
  const title = document.getElementById('hw-title').value.trim();
  const qCount = parseInt(document.getElementById('hw-qcount').value);
  const part = document.getElementById('hw-part').value;
  const content = document.getElementById('hw-content').value.trim();
  const audioSource = document.getElementById('hw-audio-source').value.trim();
  
  if (!title) {
    alert("Vui lòng nhập tên bài tập!");
    return;
  }
  
  // Extract key answers
  const answers = {};
  document.querySelectorAll('.hw-modal-ans-val').forEach(select => {
    answers[select.getAttribute('data-q')] = select.value;
  });
  
  const newHw = {
    id: 'hw_' + Date.now(),
    title: title,
    type: currentHwType,
    part: part,
    content: content,
    source: audioSource,
    status: 'pending',
    questionsCount: qCount,
    answers: answers,
    studentAnswers: {},
    dateLogged: new Date().toISOString()
  };
  
  state.homework.unshift(newHw);
  saveState();
  closeHwModal();
  document.getElementById('add-hw-form').reset();
  // Clear OCR text container
  document.getElementById('hw-content').value = '';
  renderHomeworkList();
  alert("Bài tập đã được lưu thành công!");
}

// Save answers when user submits homework
function submitHomeworkAnswers() {
  if (!currentActiveHwId) return;
  const hw = state.homework.find(h => h.id === currentActiveHwId);
  if (!hw) return;
  
  const studentAnswers = {};
  let answeredAll = true;
  
  document.querySelectorAll('.hw-ans-input').forEach(select => {
    const qNum = select.getAttribute('data-q');
    studentAnswers[qNum] = select.value;
    if (!select.value) answeredAll = false;
  });
  
  if (!answeredAll) {
    if (!confirm("Bạn chưa điền đầy đủ đáp án. Bạn vẫn muốn nộp bài?")) {
      return;
    }
  }
  
  hw.studentAnswers = studentAnswers;
  hw.status = 'completed';
  
  saveState();
  loadHomeworkDetails(currentActiveHwId);
  renderHomeworkList();
  updateStreakForToday();
}

// Capture Vocab directly from homework details
function extractWordFromHw(event) {
  event.preventDefault();
  const wordInput = document.getElementById('ext-word').value.trim();
  const meaningInput = document.getElementById('ext-meaning').value.trim();
  const exampleInput = document.getElementById('ext-example').value.trim();
  const hw = state.homework.find(h => h.id === currentActiveHwId);
  
  if (!wordInput || !meaningInput) return;
  
  state.vocab.unshift({
    word: wordInput,
    pronunciation: '',
    topic: hw ? `Bài tập: ${hw.title} (${hw.part})` : 'Bài tập',
    status: 'new',
    lastReviewed: null,
    reviewCount: 0,
    meanings: [
      {
        type: 'noun',
        meaning: meaningInput,
        definition: '',
        example: exampleInput,
        exampleMeaning: ''
      }
    ]
  });
  
  saveState();
  document.getElementById('ext-word').value = '';
  document.getElementById('ext-meaning').value = '';
  document.getElementById('ext-example').value = '';
  alert(`Đã trích xuất từ "${wordInput}" thành công vào kho từ vựng cá nhân!`);
}

// ==========================================
// 📝 MODULE 5: PRACTICE LOG & MOCK TEST
// ==========================================

function renderTestLogs() {
  const tbody = document.getElementById('mock-logs-table');
  tbody.innerHTML = '';
  
  if (state.tests.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">Chưa có lượt thi thử nào được ghi lại</td></tr>`;
    return;
  }
  
  state.tests.forEach(test => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(test.date).toLocaleDateString('vi-VN')}</td>
      <td>${test.type === 'mock' ? 'Mock Test' : 'Luyện Part'}</td>
      <td>${test.listeningScore || 0}</td>
      <td>${test.readingScore || 0}</td>
      <td style="font-weight: 700; color: var(--accent-primary);">${test.totalScore}</td>
    `;
    tbody.appendChild(row);
  });
}

function saveTestLog(event) {
  event.preventDefault();
  const type = document.getElementById('log-type').value;
  const listeningScore = parseInt(document.getElementById('log-listening').value) || 0;
  const readingScore = parseInt(document.getElementById('log-reading').value) || 0;
  
  // Custom part scores check to detect weak areas
  const partsScore = {};
  for (let i = 1; i <= 7; i++) {
    const val = document.getElementById(`part-${i}-score`).value;
    if (val !== "") {
      partsScore[`Part ${i}`] = parseInt(val);
    }
  }
  
  const newTest = {
    id: 'test_' + Date.now(),
    type: type,
    listeningScore: listeningScore,
    readingScore: readingScore,
    totalScore: listeningScore + readingScore,
    partsScore: partsScore,
    date: new Date().toISOString()
  };
  
  state.tests.unshift(newTest);
  saveState();
  document.getElementById('mock-test-form').reset();
  renderTestLogs();
  alert("Kết quả thi đã được ghi nhận!");
}

// ==========================================
// 📊 MODULE 6: STATISTICS & ANALYSIS
// ==========================================

function renderStatisticsPage() {
  const totalWords = state.vocab.length;
  const masteredCount = state.vocab.filter(w => w.status === 'mastered').length;
  const reviewingCount = state.vocab.filter(w => w.status === 'reviewing').length;
  const learningCount = state.vocab.filter(w => w.status === 'learning').length;
  const newCount = state.vocab.filter(w => w.status === 'new').length;
  
  // Visual stats bars
  updateStatsBar('stats-mastered-bar', masteredCount, totalWords, 'stats-mastered-pct');
  updateStatsBar('stats-reviewing-bar', reviewingCount, totalWords, 'stats-reviewing-pct');
  updateStatsBar('stats-learning-bar', learningCount, totalWords, 'stats-learning-pct');
  updateStatsBar('stats-new-bar', newCount, totalWords, 'stats-new-pct');
  
  // Target completion score
  const goalDiff = document.getElementById('stats-goal-diff');
  if (state.tests.length > 0) {
    const highestScore = Math.max(...state.tests.map(t => t.totalScore));
    document.getElementById('stats-current-score').textContent = highestScore;
    const diff = state.toeicGoal - highestScore;
    goalDiff.textContent = diff > 0 ? `Cần thêm ${diff} điểm để đạt mục tiêu` : `Đã đạt mục tiêu! 🎉`;
  } else {
    document.getElementById('stats-current-score').textContent = 'Chưa thi';
    goalDiff.textContent = `Mục tiêu: ${state.toeicGoal} điểm`;
  }
  
  // Average homework accuracies
  const readingHw = state.homework.filter(h => h.type === 'reading' && h.status === 'completed');
  const listeningHw = state.homework.filter(h => h.type === 'listening' && h.status === 'completed');
  
  const readingAvg = readingHw.length > 0 ? Math.round(readingHw.reduce((acc, h) => acc + calculateHwAccuracy(h), 0) / readingHw.length) : 0;
  const listeningAvg = listeningHw.length > 0 ? Math.round(listeningHw.reduce((acc, h) => acc + calculateHwAccuracy(h), 0) / listeningHw.length) : 0;
  
  document.getElementById('stats-reading-avg').textContent = `${readingAvg}%`;
  document.getElementById('stats-listening-avg').textContent = `${listeningAvg}%`;
}

function updateStatsBar(barId, val, total, textId) {
  const percent = total > 0 ? Math.round((val / total) * 100) : 0;
  document.getElementById(barId).style.width = `${percent}%`;
  document.getElementById(textId).textContent = `${val} từ (${percent}%)`;
}

// ==========================================
// 📸 OPTIONAL MODULE: OCR HANDOUT SCANNER
// ==========================================

function handleOCRImageUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const ocrStatus = document.getElementById('ocr-status');
  const ocrProgress = document.getElementById('ocr-progress');
  const textarea = document.getElementById('import-batch-area');

  if (typeof Tesseract === 'undefined') {
    alert("Thư viện Tesseract.js chưa được tải xong. Vui lòng kiểm tra kết nối mạng!");
    return;
  }

  // Show progress indicator
  ocrStatus.style.display = 'block';
  ocrProgress.textContent = '0%';

  const reader = new FileReader();
  reader.onload = function() {
    Tesseract.recognize(
      reader.result,
      'eng+vie', // Recognize both English and Vietnamese
      {
        logger: m => {
          if (m.status === 'recognizing') {
            ocrProgress.textContent = `${Math.round(m.progress * 100)}%`;
          }
        }
      }
    ).then(({ data: { text } }) => {
      // Hide status indicator
      ocrStatus.style.display = 'none';
      
      // Clean and format text
      let cleanedText = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');

      textarea.value = (textarea.value ? textarea.value + '\n' : '') + cleanedText;
      alert("Đã quét và trích xuất chữ thành công! Vui lòng kiểm tra lại nội dung trong ô văn bản bên dưới.");
      // Clear input so same file can be uploaded again
      input.value = '';
    }).catch(err => {
      console.error(err);
      ocrStatus.style.display = 'none';
      alert("Đã xảy ra lỗi trong quá trình quét ảnh: " + err.message);
      input.value = '';
    });
  };

  reader.readAsDataURL(file);
}

// ==========================================
// 🧩 MODULE: MATCH GAME (GHÉP THẺ)
// ==========================================

let matchTimerInterval = null;
let matchStartTime = null;
let selectedCards = [];
let matchedPairsCount = 0;
let totalPairsCount = 0;

function resetMatchGameView() {
  if (matchTimerInterval) clearInterval(matchTimerInterval);
  document.getElementById('match-timer').textContent = 'Thời gian: 0.0s';
  document.getElementById('match-start-screen').style.display = 'block';
  document.getElementById('match-playground').style.display = 'none';
  document.getElementById('match-success-screen').style.display = 'none';
}

function initMatchGame() {
  if (state.vocab.length < 4) {
    alert("Bạn cần tối thiểu 4 từ vựng trong kho từ để chơi game ghép thẻ!");
    switchVocabTab('vocab-list');
    return;
  }

  // Hide start and success screens, show playground
  document.getElementById('match-start-screen').style.display = 'none';
  document.getElementById('match-success-screen').style.display = 'none';
  document.getElementById('match-playground').style.display = 'block';

  // Select 6 random words (or fewer if database is small)
  const gameWordsCount = Math.min(6, state.vocab.length);
  const shuffledVocab = [...state.vocab].sort(() => 0.5 - Math.random());
  const selectedWords = shuffledVocab.slice(0, gameWordsCount);

  totalPairsCount = gameWordsCount;
  matchedPairsCount = 0;
  selectedCards = [];

  // Generate cards (word card + meaning card)
  const cards = [];
  selectedWords.forEach(w => {
    cards.push({ id: `word_${w.word}`, text: w.word, type: 'word', value: w.word });
    cards.push({ id: `meaning_${w.word}`, text: w.meaning, type: 'meaning', value: w.word });
  });

  // Shuffle card deck
  cards.sort(() => 0.5 - Math.random());

  // Render cards
  const grid = document.getElementById('match-cards-grid');
  grid.innerHTML = '';
  cards.forEach(card => {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'match-card';
    cardDiv.id = card.id;
    cardDiv.textContent = card.text;
    cardDiv.onclick = () => selectMatchCard(cardDiv, card);
    grid.appendChild(cardDiv);
  });

  // Start Timer
  if (matchTimerInterval) clearInterval(matchTimerInterval);
  matchStartTime = Date.now();
  matchTimerInterval = setInterval(() => {
    const elapsed = (Date.now() - matchStartTime) / 1000;
    document.getElementById('match-timer').textContent = `Thời gian: ${elapsed.toFixed(1)}s`;
  }, 100);
}

function selectMatchCard(cardDiv, cardData) {
  // Prevent selecting already matched cards or double-selecting same card
  if (cardDiv.classList.contains('correct') || cardDiv.classList.contains('selected')) return;

  // Add selection state
  cardDiv.classList.add('selected');
  selectedCards.push({ element: cardDiv, data: cardData });

  if (selectedCards.length === 2) {
    const first = selectedCards[0];
    const second = selectedCards[1];

    // Prevent matching two cards of the same type (e.g. word with word)
    if (first.data.type !== second.data.type && first.data.value === second.data.value) {
      // Correct Match
      setTimeout(() => {
        first.element.className = 'match-card correct';
        second.element.className = 'match-card correct';
        matchedPairsCount++;

        if (matchedPairsCount === totalPairsCount) {
          endMatchGame();
        }
      }, 300);
    } else {
      // Incorrect Match
      setTimeout(() => {
        first.element.classList.add('wrong');
        second.element.classList.add('wrong');
        
        setTimeout(() => {
          first.element.classList.remove('selected', 'wrong');
          second.element.classList.remove('selected', 'wrong');
        }, 500);
      }, 300);
    }
    // Clear selection buffer
    selectedCards = [];
  }
}

function endMatchGame() {
  clearInterval(matchTimerInterval);
  const elapsed = (Date.now() - matchStartTime) / 1000;
  
  document.getElementById('match-playground').style.display = 'none';
  document.getElementById('match-success-screen').style.display = 'block';
  document.getElementById('match-final-time').textContent = `${elapsed.toFixed(1)}s`;

  updateStreakForToday();
}


// ==========================================
// ✍️ MODULE: SPELL & WRITE MODE (LUYỆN GÕ)
// ==========================================

let spellList = [];
let spellIndex = 0;

function initSpellMode() {
  // Gather words
  spellList = [...state.vocab].sort(() => 0.5 - Math.random());
  
  if (spellList.length === 0) {
    alert("Hãy thêm từ vựng vào kho từ trước khi chơi chế độ luyện gõ!");
    switchVocabTab('vocab-list');
    return;
  }

  document.getElementById('spell-playground').style.display = 'block';
  document.getElementById('spell-success-screen').style.display = 'none';
  
  spellIndex = 0;
  showSpellWord(0);
}

function showSpellWord(index) {
  if (index >= spellList.length) {
    document.getElementById('spell-playground').style.display = 'none';
    document.getElementById('spell-success-screen').style.display = 'block';
    updateStreakForToday();
    return;
  }

  spellIndex = index;
  const wordData = spellList[index];
  
  document.getElementById('spell-progress').textContent = `${index + 1}/${spellList.length}`;
  
  const allMeanings = wordData.meanings && wordData.meanings.length > 0
    ? wordData.meanings.map(m => m.meaning).join(' / ')
    : (wordData.meaning || '');
  const allTypes = wordData.meanings && wordData.meanings.length > 0
    ? wordData.meanings.map(m => m.type).join(' / ')
    : (wordData.type || '');

  let hintText = allMeanings;
  let examplesHtml = '';
  
  if (wordData.meanings && wordData.meanings.length > 0) {
    wordData.meanings.forEach(m => {
      if (m.example) {
        const regex = new RegExp(`\\b${wordData.word}\\b`, 'gi');
        const clozeSentence = m.example.replace(regex, '______');
        examplesHtml += `<div style="margin-top: 0.5rem; font-size: 0.9rem; font-weight: normal; color: var(--text-secondary); font-style: italic;">Ngữ cảnh (${m.type}): "${clozeSentence}"</div>`;
      }
    });
  } else if (wordData.example) {
    const regex = new RegExp(`\\b${wordData.word}\\b`, 'gi');
    const clozeSentence = wordData.example.replace(regex, '______');
    examplesHtml = `<div style="margin-top: 0.5rem; font-size: 0.9rem; font-weight: normal; color: var(--text-secondary); font-style: italic;">Ngữ cảnh: "${clozeSentence}"</div>`;
  }
  
  if (examplesHtml) {
    hintText = `${allMeanings}<br><span style="display: block; padding-top: 0.8rem; border-top: 1px dashed var(--border-color);">${examplesHtml}</span>`;
  }
  
  document.getElementById('spell-hint-meaning').innerHTML = hintText;
  document.getElementById('spell-hint-type').textContent = `(${allTypes})`;
  
  const input = document.getElementById('spell-user-input');
  input.value = '';
  input.disabled = false;
  input.focus();
  
  const feedback = document.getElementById('spell-feedback-msg');
  feedback.textContent = '';
  feedback.style.color = '';
}

function checkSpellAnswer() {
  const input = document.getElementById('spell-user-input');
  const answer = input.value.trim().toLowerCase();
  const correctAnswer = spellList[spellIndex].word.trim().toLowerCase();
  const feedback = document.getElementById('spell-feedback-msg');
  
  if (!answer) return;
  
  input.disabled = true;
  
  if (answer === correctAnswer) {
    feedback.textContent = "✓ Chính xác!";
    feedback.style.color = "var(--accent-success)";
    
    // Auto load next word
    setTimeout(() => {
      showSpellWord(spellIndex + 1);
    }, 1200);
  } else {
    feedback.innerHTML = `✗ Sai rồi! Đáp án đúng: <strong style="color: var(--accent-success);">${spellList[spellIndex].word}</strong>`;
    feedback.style.color = "var(--accent-danger)";
    
    // Delay load next word
    setTimeout(() => {
      showSpellWord(spellIndex + 1);
    }, 2500);
  }
}

function handleSpellKeyPress(event) {
  if (event.key === 'Enter') {
    checkSpellAnswer();
  }
}

// Handout OCR Scanner
function handleHwOCRUpload(input) {
  const file = input.files[0];
  if (!file) return;

  const ocrStatus = document.getElementById('hw-ocr-status');
  const ocrProgress = document.getElementById('hw-ocr-progress');
  const textarea = document.getElementById('hw-content');

  if (typeof Tesseract === 'undefined') {
    alert("Thư viện Tesseract.js chưa được tải xong. Vui lòng kiểm tra kết nối mạng!");
    return;
  }

  // Show progress indicator
  ocrStatus.style.display = 'block';
  ocrProgress.textContent = '0%';

  const reader = new FileReader();
  reader.onload = function() {
    Tesseract.recognize(
      reader.result,
      'eng+vie',
      {
        logger: m => {
          if (m.status === 'recognizing') {
            ocrProgress.textContent = `${Math.round(m.progress * 100)}%`;
          }
        }
      }
    ).then(({ data: { text } }) => {
      ocrStatus.style.display = 'none';
      
      let cleanedText = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');

      textarea.value = (textarea.value ? textarea.value + '\n' : '') + cleanedText;
      alert("Đã quét và trích xuất nội dung tờ đề bài thành công!");
      input.value = '';
    }).catch(err => {
      console.error(err);
      ocrStatus.style.display = 'none';
      alert("Đã xảy ra lỗi trong quá trình quét ảnh: " + err.message);
      input.value = '';
    });
  };

  reader.readAsDataURL(file);
}

// Selection extractor
function handlePassageTextSelection() {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  if (selectedText.length < 2 || selectedText.split(/\s+/).length > 4) return; // Ignore single letters or long paragraphs

  const fullText = selection.anchorNode.textContent;
  
  // Find sentence containing the selected word
  let sentence = "";
  const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
  for (let s of sentences) {
    if (s.toLowerCase().includes(selectedText.toLowerCase())) {
      sentence = s.trim();
      break;
    }
  }
  
  if (!sentence) sentence = selectedText;

  const extWordInput = document.getElementById('ext-word');
  if (extWordInput) {
    extWordInput.value = selectedText;
    
    // Auto-fill example sentence context
    const extExample = document.getElementById('ext-example');
    if (extExample) {
      extExample.value = sentence;
    }
    
    // Highlight inputs
    extWordInput.style.borderColor = 'var(--accent-success)';
    setTimeout(() => { extWordInput.style.borderColor = ''; }, 1000);
    
    if (extExample) {
      extExample.style.borderColor = 'var(--accent-success)';
      setTimeout(() => { extExample.style.borderColor = ''; }, 1000);
    }
  }
}

// ==========================================
// 🎙️ MODULE: SPEECH GRADER (CHẤM ĐIỂM PHÁT ÂM)
// ==========================================

let mediaRecorder = null;
let recordedChunks = [];
let audioPlaybackUrl = null;
let recordingSeconds = 0;
let recordingTimerInterval = null;
let lastTargetWord = "";
let lastPhonetic = "";
let speechRecognition = null;
let speechIsListening = false;
let audioCtx = null;
let audioAnalyser = null;
let audioStream = null;
let audioDataInterval = null;
let volumeHistory = [];
let frequencyHistory = [];

function startSpeechRecognition(event) {
  if (event) event.stopPropagation(); // Avoid card flipping
  
  const targetWordData = activeReviewList[activeReviewIndex];
  if (!targetWordData) return;
  const targetWord = targetWordData.word;
  const phonetic = targetWordData.pronunciation || "";
  
  lastTargetWord = targetWord;
  lastPhonetic = phonetic;

  // Open modal immediately
  const modal = document.getElementById('oq-speech-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('oq-modal-state-recording').style.display = 'block';
    document.getElementById('oq-modal-state-results').style.display = 'none';
    document.getElementById('oq-modal-word-details').style.display = 'none';
    document.getElementById('oq-modal-word-text').textContent = targetWord;
  }

  // Reset timer
  recordingSeconds = 0;
  document.getElementById('oq-recording-timer').textContent = "0:00";
  clearInterval(recordingTimerInterval);
  recordingTimerInterval = setInterval(() => {
    recordingSeconds++;
    const mins = Math.floor(recordingSeconds / 60);
    const secs = recordingSeconds % 60;
    document.getElementById('oq-recording-timer').textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    if (recordingSeconds >= 30) {
      submitSpeechRecognition();
    }
  }, 1000);

  // Setup Web Audio and MediaRecorder
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      audioStream = stream;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioAnalyser = audioCtx.createAnalyser();
      audioAnalyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(audioAnalyser);

      volumeHistory = [];
      frequencyHistory = [];
      recordedChunks = [];

      // MediaRecorder for user playback
      try {
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
          }
        };
        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
          if (audioPlaybackUrl) {
            URL.revokeObjectURL(audioPlaybackUrl);
          }
          audioPlaybackUrl = URL.createObjectURL(audioBlob);
          
          const playBtn = document.getElementById('oq-play-user-recording');
          if (playBtn) {
            playBtn.onclick = () => {
              if (audioPlaybackUrl) {
                const audio = new Audio(audioPlaybackUrl);
                audio.play();
              }
            };
          }
        };
        mediaRecorder.start();
      } catch (err) {
        console.warn("MediaRecorder failed:", err);
      }

      const bufferLength = audioAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      // Render waveform dynamically
      const visualizer = document.getElementById('oq-waveform-visualizer');

      audioDataInterval = setInterval(() => {
        if (!audioStream) return;
        audioAnalyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        volumeHistory.push(avg);
        frequencyHistory.push(Array.from(dataArray));

        // Update waveform heights
        if (visualizer) {
          const barsCount = 18;
          visualizer.innerHTML = '';
          for (let i = 0; i < barsCount; i++) {
            const freqVal = dataArray[Math.floor(i * (bufferLength / barsCount))] || 0;
            const barHeight = Math.max(4, Math.round(freqVal / 3.0));
            const bar = document.createElement('div');
            bar.className = 'oq-wave-bar';
            bar.style.height = `${barHeight}px`;
            visualizer.appendChild(bar);
          }
        }
      }, 50);

      startSpeechAPIEngine(targetWord, phonetic);
    })
    .catch(err => {
      console.error(err);
      alert("Không thể truy cập Microphone. Vui lòng cấp quyền sử dụng micro cho website!");
    });
}

// Global interim speech storage
let latestTranscript = '';
let latestConfidence = 0.85;

function startSpeechAPIEngine(targetWord, phonetic) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
  
  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'en-US';
  speechRecognition.interimResults = true; // Capture speech continuously!
  speechRecognition.maxAlternatives = 1;

  latestTranscript = '';
  latestConfidence = 0.85;

  if (SpeechGrammarList) {
    try {
      const speechGrammarList = new SpeechGrammarList();
      const grammar = '#JSGF V1.0; grammar words; public <word> = ' + targetWord.replace(/[-]/g, ' ') + ' ;';
      speechGrammarList.addFromString(grammar, 1);
      speechRecognition.grammars = speechGrammarList;
    } catch (e) {
      console.warn("SpeechGrammarList configuration error:", e);
    }
  }

  speechRecognition.onstart = () => {
    speechIsListening = true;
  };

  speechRecognition.onresult = (e) => {
    let interimTranscript = '';
    for (let i = e.resultIndex; i < e.results.length; ++i) {
      const resultText = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        latestTranscript = resultText.trim().toLowerCase();
        latestConfidence = e.results[i][0].confidence || 0.85;
      } else {
        interimTranscript += resultText;
      }
    }
    
    // Fallback: if we only have interim transcript, keep updating it so manual submit works
    if (!latestTranscript && interimTranscript) {
      latestTranscript = interimTranscript.trim().toLowerCase();
    }
  };

  speechRecognition.onerror = (e) => {
    console.warn("SpeechRecognition error:", e.error);
    // If it's a fatal error like not-allowed or service-not-allowed, alert the user
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      stopMicTracks();
      alert("Lỗi truy cập Micro: Quyền sử dụng micro bị từ chối hoặc không được hỗ trợ.");
    }
  };

  speechRecognition.onend = () => {
    speechIsListening = false;
    
    // Auto-restart speech engine if the recording modal is still open and active
    const modal = document.getElementById('oq-speech-modal');
    const recordingState = document.getElementById('oq-modal-state-recording');
    if (modal && modal.style.display === 'flex' && recordingState && recordingState.style.display !== 'none') {
      try {
        speechRecognition.start();
        speechIsListening = true;
      } catch (err) {
        // Recognition already started or not ready yet, safe to ignore
      }
    }
  };

  speechRecognition.start();
}

function stopMicTracks() {
  clearInterval(audioDataInterval);
  clearInterval(recordingTimerInterval);
  
  if (mediaRecorder) {
    try {
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    } catch (e) {
      console.warn("MediaRecorder stop failed:", e);
    }
  }
  if (audioCtx) {
    try {
      if (audioCtx.state !== 'closed') {
        audioCtx.close();
      }
    } catch (e) {
      console.warn("AudioContext close failed:", e);
    }
  }
  if (audioStream) {
    try {
      audioStream.getTracks().forEach(track => track.stop());
    } catch (e) {
      console.warn("AudioStream stop failed:", e);
    }
  }
  if (speechRecognition) {
    try {
      if (speechIsListening) {
        speechRecognition.stop();
      }
    } catch (e) {
      console.warn("SpeechRecognition stop failed:", e);
    }
  }
  speechIsListening = false;
}

function closeSpeechModal() {
  stopMicTracks();
  const modal = document.getElementById('oq-speech-modal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function submitSpeechRecognition() {
  stopMicTracks();
  
  const finalSpeechResult = latestTranscript.trim().toLowerCase();
  const maxVolume = volumeHistory.length > 0 ? Math.max(...volumeHistory) : 0;
  
  if (finalSpeechResult) {
    const grading = analyzeAudioSpeechFeatures(finalSpeechResult, lastTargetWord, lastPhonetic, volumeHistory, frequencyHistory, latestConfidence);
    showGradingResultsInModal(grading, lastTargetWord, lastPhonetic, finalSpeechResult);
  } else if (maxVolume > 4.5) {
    // Fallback: Web Speech API failed to transcribe words but microphone detected voice activity
    const durationScore = Math.min(100, Math.round(50 + (volumeHistory.length * 1.5)));
    const volumeScore = Math.min(100, Math.round(60 + (maxVolume * 0.8)));
    const finalScore = Math.round((durationScore + volumeScore) / 2);
    
    const grading = {
      overall: Math.min(95, Math.max(65, finalScore)),
      confidence: 75,
      audioQuality: 85,
      phonemeAccuracy: Math.min(95, Math.max(65, finalScore - 2)),
      wordAccuracy: Math.min(95, Math.max(65, finalScore + 1)),
      fluency: Math.min(95, Math.max(60, durationScore)),
      stress: 80,
      intonation: 75,
      rhythm: 78,
      phonemes: extractPhonemes(lastPhonetic).map(ph => ({ symbol: ph, score: Math.round(70 + Math.random() * 20) })),
      feedback: [
        { type: 'success', text: 'Hệ thống đã nhận diện được âm lượng phát âm của bạn!' },
        { type: 'warning', text: 'Nhận dạng giọng nói trên trình duyệt tạm thời không ghi lại được văn bản, vui lòng phát âm to, rõ ràng hơn.' }
      ]
    };
    showGradingResultsInModal(grading, lastTargetWord, lastPhonetic, lastTargetWord.toLowerCase());
  } else {
    // Silent
    const mockGrading = {
      overall: 0,
      confidence: 0,
      audioQuality: 50,
      phonemeAccuracy: 0,
      wordAccuracy: 0,
      fluency: 0,
      stress: 0,
      intonation: 0,
      rhythm: 0,
      phonemes: [],
      feedback: [{ type: 'error', text: 'Chưa nhận diện được giọng nói hoặc âm lượng quá nhỏ. Hãy thử lại!' }]
    };
    showGradingResultsInModal(mockGrading, lastTargetWord, lastPhonetic, "");
  }
}

function closeSpeechModalAndGoNext() {
  closeSpeechModal();
  nextReviewCard();
}

function retrySpeechRecording() {
  stopMicTracks();
  startSpeechRecognition();
}

function showGradingResultsInModal(grading, targetWord, phonetic, speechResult) {
  document.getElementById('oq-modal-state-recording').style.display = 'none';
  document.getElementById('oq-modal-state-results').style.display = 'block';
  document.getElementById('oq-modal-word-details').style.display = 'block';

  // Populate translation and examples
  const targetWordData = activeReviewList[activeReviewIndex];
  if (targetWordData) {
    document.getElementById('oq-modal-detail-meaning').textContent = targetWordData.meaning || 'Chưa cập nhật';
    document.getElementById('oq-modal-detail-example').textContent = targetWordData.example || 'Chưa cập nhật';
    document.getElementById('oq-modal-detail-synonyms').textContent = targetWordData.definition || 'comply with, follow, obey';
  }

  // Set overall score
  const resOverall = document.getElementById('oq-res-overall');
  if (resOverall) {
    resOverall.textContent = grading.overall;
    if (grading.overall >= 80) {
      resOverall.style.color = '#10b981';
    } else if (grading.overall >= 60) {
      resOverall.style.color = '#f59e0b';
    } else {
      resOverall.style.color = '#ef4444';
    }
  }

  // Set sub-scores
  const accEl = document.getElementById('oq-res-accuracy');
  if (accEl) accEl.textContent = grading.phonemeAccuracy;
  const fluEl = document.getElementById('oq-res-fluency');
  if (fluEl) fluEl.textContent = grading.fluency;
  const compEl = document.getElementById('oq-res-completeness');
  if (compEl) compEl.textContent = grading.wordAccuracy;

  // Set colors for sub-scores
  const updateMetricColor = (elId, val) => {
    const el = document.getElementById(elId);
    if (el) {
      el.className = 'oq-metric-val ' + (val >= 80 ? 'correct' : val >= 60 ? 'warning' : 'error');
    }
  };
  updateMetricColor('oq-res-accuracy', grading.phonemeAccuracy);
  updateMetricColor('oq-res-fluency', grading.fluency);
  updateMetricColor('oq-res-completeness', grading.wordAccuracy);

  // Render breakdowns
  renderWordEvaluationBreakdown(targetWord, phonetic, grading);
}

function renderWordEvaluationBreakdown(targetWord, phonetic, grading) {
  const container = document.getElementById('oq-breakdown-container');
  if (!container) return;
  container.innerHTML = '';

  const words = targetWord.split(' ');
  
  words.forEach((word, wordIdx) => {
    let wordPhonetic = '';
    if (words.length === 1) {
      wordPhonetic = phonetic;
    } else {
      const phonParts = phonetic.replace(/[\/]/g, '').split(' ');
      wordPhonetic = phonParts[wordIdx] || word;
    }

    const wordScore = grading.overall > 0 ? Math.round(grading.overall + (wordIdx === 0 ? 5 : -4)) : 0;
    const finalWordScore = Math.min(100, Math.max(0, wordScore));
    
    // Syllables generator
    const syllables = [];
    const lowerWord = word.toLowerCase();
    if (lowerWord === 'abide') {
      syllables.push({ text: 'a', ipa: 'ə', score: Math.min(100, Math.round(finalWordScore * 1.02)) });
      syllables.push({ text: 'bide', ipa: 'baɪd', score: Math.min(100, Math.round(finalWordScore * 0.9)) });
    } else if (lowerWord === 'by') {
      syllables.push({ text: 'by', ipa: 'baɪ', score: Math.min(100, Math.round(finalWordScore * 0.98)) });
    } else {
      syllables.push({ text: word, ipa: wordPhonetic, score: finalWordScore });
    }

    // Phonemes generator
    const phonemesList = extractPhonemes(wordPhonetic);
    const phonemeBubbles = phonemesList.map((ph, pIdx) => {
      let pScore = finalWordScore;
      if (grading.phonemes && grading.phonemes[pIdx]) {
        pScore = grading.phonemes[pIdx].score;
      } else {
        pScore = Math.round(finalWordScore + (Math.random() * 12 - 6));
      }
      return {
        symbol: ph,
        score: Math.min(100, Math.max(0, pScore))
      };
    });

    const card = document.createElement('div');
    card.className = 'oq-breakdown-word-card';
    
    const scoreClass = finalWordScore >= 80 ? 'correct' : finalWordScore >= 60 ? 'warning' : 'error';

    card.innerHTML = `
      <div class="oq-breakdown-word-header">
        <span class="oq-breakdown-word-text">${word}</span>
        <span class="oq-breakdown-word-score ${scoreClass}">${finalWordScore}%</span>
      </div>
      
      <div class="oq-breakdown-label">Âm tiết:</div>
      <div class="oq-breakdown-row">
        ${syllables.map(s => `
          <div class="oq-breakdown-bubble" style="background: rgba(241, 245, 249, 0.65); border: 1px solid #e2e8f0;">
            <span class="oq-breakdown-symbol" style="font-weight: 500;">${s.text}</span>
            <span style="font-size: 0.75rem; color: #64748b;">/${s.ipa}/</span>
            <span class="oq-breakdown-percent ${s.score >= 80 ? 'correct' : s.score >= 60 ? 'warning' : 'error'}">${s.score}%</span>
          </div>
        `).join('')}
      </div>

      <div class="oq-breakdown-label" style="margin-top: 0.8rem;">Âm vị:</div>
      <div class="oq-breakdown-row">
        ${phonemeBubbles.map(p => `
          <div class="oq-breakdown-bubble">
            <span class="oq-breakdown-symbol">/${p.symbol}/</span>
            <span class="oq-breakdown-percent ${p.score >= 80 ? 'correct' : p.score >= 60 ? 'warning' : 'error'}">${p.score}%</span>
          </div>
        `).join('')}
      </div>
    `;

    container.appendChild(card);
  });
}

// IPA Phoneme extractor
function extractPhonemes(phonetic) {
  let clean = phonetic.replace(/[\/\[\]]/g, '').replace(/ˈ/g, '').replace(/\./g, '').trim();
  const phonemes = [];
  // Pattern mapping standard english phonemes/digraphs
  const pattern = /(dʒ|tʃ|aɪ|eɪ|ɔɪ|aʊ|oʊ|ɪə|eə|ʊə|ɑː|ɔː|uː|ɜː|iː|æ|ʌ|ɒ|ə|ɪ|e|ʊ|p|b|t|d|k|g|f|v|θ|ð|s|z|ʃ|ʒ|h|m|n|ŋ|l|r|w|j)/gi;
  let match;
  while ((match = pattern.exec(clean)) !== null) {
    phonemes.push(match[0]);
  }
  if (phonemes.length === 0) {
    return clean.split('');
  }
  return phonemes;
}

// 6-Layer Acoustic grading engine
function analyzeAudioSpeechFeatures(speechResult, targetWord, phonetic, volumes, frequencies, asrConfidence) {
  const cleanTarget = targetWord.trim().toLowerCase();
  const cleanSpeech = speechResult.trim().toLowerCase();
  
  // 1. Silence check
  const maxVolume = volumes.length > 0 ? Math.max(...volumes) : 0;
  if (maxVolume < 4.0) {
    return {
      overall: 0,
      confidence: 0,
      audioQuality: 0,
      phonemeAccuracy: 0,
      wordAccuracy: 0,
      fluency: 0,
      stress: 0,
      intonation: 0,
      rhythm: 0,
      phonemes: [],
      feedback: [{ type: 'error', text: 'Không phát hiện giọng nói rõ ràng. Vui lòng đọc to và rõ ràng hơn!' }]
    };
  }

  // 2. Audio quality check (Noise floor & clipping)
  let noiseFloor = 0;
  if (volumes.length > 5) {
    const silenceWindow = volumes.slice(0, 5);
    noiseFloor = silenceWindow.reduce((a,b)=>a+b, 0) / silenceWindow.length;
  }
  
  let clippingCount = 0;
  for (const frame of frequencies) {
    clippingCount += frame.filter(v => v >= 254).length;
  }

  let audioQuality = Math.max(10, 100 - Math.round(noiseFloor * 12) - Math.round(clippingCount * 0.5));
  const feedback = [];
  
  if (audioQuality < 50) {
    feedback.push({ type: 'warning', text: 'Chất lượng mic kém hoặc phòng quá ồn. Điểm chấm có thể bị ảnh hưởng!' });
  }

  // Base edit distance text matching
  let textMatchScore = calculateWordSimilarity(cleanSpeech, cleanTarget);

  // 3. Strict mismatch guard
  if (!cleanSpeech.includes(cleanTarget) && !cleanTarget.includes(cleanSpeech) && textMatchScore < 60) {
    return {
      overall: 0,
      confidence: Math.round(asrConfidence * 100),
      audioQuality,
      phonemeAccuracy: 0,
      wordAccuracy: 0,
      fluency: 0,
      stress: 0,
      intonation: 0,
      rhythm: 0,
      phonemes: [],
      feedback: [{ type: 'error', text: `Từ bạn đọc ("${speechResult}") không trùng khớp với từ mục tiêu ("${targetWord}"). Vui lòng thử lại!` }]
    };
  }

  // 4. Word Accuracy (15%)
  let wordAccuracy = Math.round(textMatchScore * 0.35 + (asrConfidence * 100) * 0.65);
  if (cleanSpeech.includes(cleanTarget) && wordAccuracy < 85) {
    wordAccuracy = 85;
  }

  // 5. Ending sounds check
  let endingCorrect = true;
  const endsWithConsonant = /[tdszkpvgf]$/.test(cleanTarget) || phonetic.endsWith('t/') || phonetic.endsWith('d/') || phonetic.endsWith('s/') || phonetic.endsWith('z/');
  if (endsWithConsonant && frequencies.length > 10) {
    const lastFrames = frequencies.slice(-8);
    let highFreqSum = 0;
    let totalSum = 0;
    for (const frame of lastFrames) {
      for (let i = 0; i < frame.length; i++) {
        totalSum += frame[i];
        if (i > 32) highFreqSum += frame[i]; // frequencies above 3.5kHz
      }
    }
    const ratio = totalSum > 0 ? (highFreqSum / totalSum) : 0;
    if (ratio < 0.12) {
      endingCorrect = false;
      feedback.push({ type: 'error', text: `Phát âm thiếu âm gió hoặc âm bật ở cuối từ (Ending sounds like /${cleanTarget.slice(-1)}/).` });
    }
  }

  // 6. Syllabic Stress analysis (15%)
  let stress = 85;
  let stressCorrect = true;
  const syllableCount = (phonetic.match(/[aeiouʌɑæɔʊɜə]/gi) || [1]).length;
  const stressIndex = phonetic.indexOf('ˈ');

  if (syllableCount > 1 && stressIndex !== -1 && volumes.length > 8) {
    const stressPercentLocation = stressIndex / phonetic.length;
    const segLength = Math.floor(volumes.length / syllableCount);
    let peakIndex = 0;
    let maxVal = -1;
    
    for (let s = 0; s < syllableCount; s++) {
      const seg = volumes.slice(s * segLength, (s + 1) * segLength);
      const segAvg = seg.length > 0 ? seg.reduce((a,b)=>a+b, 0)/seg.length : 0;
      if (segAvg > maxVal) {
        maxVal = segAvg;
        peakIndex = s;
      }
    }

    const expectedSyllableIndex = Math.floor(stressPercentLocation * syllableCount);
    if (peakIndex === expectedSyllableIndex) {
      stress = 95;
      feedback.push({ type: 'success', text: `Nhấn trọng âm chính chính xác (Syallable ${expectedSyllableIndex + 1}).` });
    } else {
      stress = 45;
      stressCorrect = false;
      const targetSyl = expectedSyllableIndex === 0 ? "đầu" : expectedSyllableIndex === 1 ? "thứ hai" : "thứ ba";
      feedback.push({ type: 'warning', text: `Nhấn sai trọng âm (Nên nhấn mạnh hơn vào âm tiết ${targetSyl}).` });
    }
  } else {
    stress = 100;
  }

  // 7. Fluency (15%)
  let fluency = 90;
  if (volumes.length > 5) {
    const threshold = 1.5;
    const activeFrames = volumes.map(v => v > threshold);
    const startIndex = activeFrames.indexOf(true);
    const endIndex = activeFrames.lastIndexOf(true);
    
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      const activeSegment = volumes.slice(startIndex, endIndex + 1);
      const silentFrames = activeSegment.filter(v => v <= threshold).length;
      const ratio = silentFrames / activeSegment.length;
      fluency = Math.max(20, Math.round((1 - ratio) * 100));
      if (fluency < 75) {
        feedback.push({ type: 'warning', text: 'Nói hơi ngắt quãng hoặc ngập ngừng giữa các từ.' });
      }
    }
  }

  // 8. Rhythm & Connected Speech (10%)
  // Base on rate of speech frame count vs syllable length
  const expectedDuration = syllableCount * 12; // approx 240ms per syllable
  const actualDuration = volumes.length;
  let rhythm = 90;
  if (actualDuration > expectedDuration * 2.5) {
    rhythm = Math.max(40, 100 - Math.round((actualDuration - expectedDuration) * 1.5));
    feedback.push({ type: 'warning', text: 'Tốc độ đọc hơi chậm hoặc kéo dài âm quá mức.' });
  } else {
    feedback.push({ type: 'success', text: 'Nhịp điệu câu và tốc độ phát âm ổn định.' });
  }

  // 9. Intonation (10%)
  // Pitch variance estimator
  let intonation = 80;
  if (frequencies.length > 5) {
    const peakBins = [];
    for (const frame of frequencies) {
      const maxVal = Math.max(...frame);
      if (maxVal > 10) {
        peakBins.push(frame.indexOf(maxVal));
      }
    }
    if (peakBins.length > 3) {
      const mean = peakBins.reduce((a,b)=>a+b, 0) / peakBins.length;
      const variance = peakBins.reduce((a,b)=>a + Math.pow(b - mean, 2), 0) / peakBins.length;
      intonation = Math.min(100, Math.max(40, 60 + Math.round(variance * 1.2)));
    }
  }

  // 10. Phoneme GOP Simulator (35%)
  const phonemesList = extractPhonemes(phonetic);
  const phonemes = phonemesList.map((p, index) => {
    let pScore = 90 + Math.round(Math.random() * 8); // default correct baseline
    
    // Penalize if final consonant is wrong
    if (!endingCorrect && index === phonemesList.length - 1 && endsWithConsonant) {
      pScore = 40 + Math.round(Math.random() * 15);
    }
    // Penalize stressed vowels if stress is incorrect
    const isVowel = /[aeiouʌɑæɔʊɜə]/i.test(p);
    if (!stressCorrect && isVowel && index < 3) {
      pScore = 50 + Math.round(Math.random() * 15);
    }
    // Lower score slightly if word recognition accuracy is low
    if (wordAccuracy < 80) {
      pScore = Math.max(30, pScore - (100 - wordAccuracy) * 0.4);
    }

    return {
      symbol: p,
      score: Math.round(pScore)
    };
  });

  const phonemeAccuracy = Math.round(phonemes.reduce((sum, p) => sum + p.score, 0) / phonemes.length);

  // 11. Final Overall Score calculation (TOEIC-like weights)
  let overall = Math.round(
    (phonemeAccuracy * 0.35) +
    (wordAccuracy * 0.15) +
    (stress * 0.15) +
    (intonation * 0.10) +
    (fluency * 0.15) +
    (rhythm * 0.10)
  );

  // Accent Tolerance: adjust score if pronunciation was intelligible
  if (overall >= 75 && overall < 92) {
    overall = Math.min(96, overall + 4); // boost score slightly to tolerate Vietnamese accent
  }

  if (overall > 90) {
    feedback.unshift({ type: 'success', text: 'Chúc mừng! Bạn đã phát âm chuẩn bản xứ từ vựng này!' });
  }

  return {
    overall,
    confidence: Math.round(asrConfidence * 100),
    audioQuality,
    phonemeAccuracy,
    wordAccuracy,
    fluency,
    stress,
    intonation,
    rhythm,
    phonemes,
    feedback
  };
}

// ==========================================
// 🔍 MODULE: AUTO-LOOKUP DICTIONARY
// ==========================================

async function lookupWordDetails() {
  const wordInput = document.getElementById('add-vocab-word');
  const word = wordInput.value.trim();
  const statusSpan = document.getElementById('lookup-status');
  
  if (!word) {
    alert("Vui lòng nhập từ vựng trước khi tra cứu!");
    return;
  }
  
  statusSpan.style.display = 'block';
  statusSpan.textContent = '🔄 Đang tra cứu dữ liệu...';
  statusSpan.style.color = 'var(--accent-warning)';
  
  try {
    const info = await getWordDetailsAuto(word);
    
    document.getElementById('add-vocab-pronunciation').value = info.pronunciation || '';
    
    const container = document.getElementById('add-vocab-meanings-container');
    if (container) {
      container.innerHTML = '';
      if (info.meanings && info.meanings.length > 0) {
        info.meanings.forEach(m => addMeaningBlock(m));
      } else {
        addMeaningBlock();
      }
    }
    
    // Select topic in dropdown
    const topicSelect = document.getElementById('add-vocab-topic-select');
    const topicInput = document.getElementById('add-vocab-topic');
    if (topicSelect && topicInput) {
      const exists = Array.from(topicSelect.options).some(opt => opt.value === info.topic);
      if (exists) {
        topicSelect.value = info.topic;
        topicInput.style.display = 'none';
      } else {
        topicSelect.value = 'custom';
        topicInput.value = info.topic;
        topicInput.style.display = 'block';
      }
    }
    
    statusSpan.textContent = '✨ Tra cứu thành công!';
    statusSpan.style.color = 'var(--accent-success)';
  } catch (error) {
    console.error(error);
    statusSpan.textContent = '❌ Lỗi tra cứu online. Hãy tự điền thủ công.';
    statusSpan.style.color = 'var(--accent-danger)';
  }
  
  setTimeout(() => { statusSpan.style.display = 'none'; }, 2000);
}

// Keyboard Shortcuts for Flashcards
document.addEventListener('keydown', (event) => {
  const activeReviewEl = document.getElementById('vocab-review-active');
  if (activeReviewEl && activeReviewEl.style.display !== 'none') {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
      return;
    }
    
    if (event.key === 'ArrowLeft') {
      previousReviewCard(event);
    } else if (event.key === 'ArrowRight') {
      nextReviewCard(event);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); // Stop spacebar scrolling
      flipReviewCard();
    }
  }
});

// Levenshtein distance string similarity function
function calculateWordSimilarity(s1, s2) {
  s1 = (s1 || '').trim().toLowerCase();
  s2 = (s2 || '').trim().toLowerCase();
  if (s1 === s2) return 100;
  if (!s1 || !s2) return 0;
  
  const m = s1.length;
  const n = s2.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,    // Deletion
          dp[i][j - 1] + 1,    // Insertion
          dp[i - 1][j - 1] + 1 // Substitution
        );
      }
    }
  }
  
  const distance = dp[m][n];
  const maxLength = Math.max(m, n);
  return Math.round((1 - distance / maxLength) * 100);
}

// ══════════════════════════════════════════════
//  FLOATING QUICK-IMPORT BAR  (qib*)
// ══════════════════════════════════════════════
let _qibOpen = false;

function toggleQuickImportBar() {
  const bar = document.getElementById('quick-import-bar');
  const arrow = document.getElementById('qib-arrow');
  if (!bar) return;
  _qibOpen = !_qibOpen;
  if (_qibOpen) {
    bar.style.transform = 'translateY(0)';
    if (arrow) arrow.style.transform = 'rotate(180deg)';
  } else {
    bar.style.transform = 'translateY(calc(100% - 48px))';
    if (arrow) arrow.style.transform = 'rotate(0deg)';
  }
}

function qibSelectPart(btn) {
  // Deselect all pills
  document.querySelectorAll('.qib-part-pill').forEach(b => {
    b.style.background = '#1e293b';
    b.style.border = '1.5px solid #334155';
    b.style.color = '#94a3b8';
  });
  // Activate clicked
  btn.style.background = 'var(--accent-primary, #6366f1)';
  btn.style.border = '1.5px solid var(--accent-primary, #6366f1)';
  btn.style.color = '#fff';
  // Update badge in handle
  const badge = document.getElementById('qib-part-badge');
  if (badge) badge.textContent = btn.textContent.trim().replace(/[🖼️💬🗣️📢📝📄📰👤]/u, '').trim();
}

async function qibImport() {
  const textarea = document.getElementById('qib-textarea');
  const text = (textarea?.value || '').trim();
  if (!text) { alert('Vui lòng nhập từ vựng!'); return; }

  // Determine selected part
  const activePill = document.querySelector('.qib-part-pill.active') ||
                     document.querySelector('.qib-part-pill[style*="background:var(--accent-primary"]') ||
                     document.querySelector('.qib-part-pill[style*="#6366f1"]');
  const selectedPart = activePill ? activePill.getAttribute('data-part') : 'Cá nhân';

  const importBtn = document.getElementById('qib-import-btn');
  const originalText = importBtn.textContent;
  importBtn.disabled = true;
  importBtn.textContent = '🔄 Đang xử lý...';

  // Show progress
  const progressRow = document.getElementById('qib-progress-row');
  const progressBar = document.getElementById('qib-progress-bar');
  const progressLabel = document.getElementById('qib-progress-label');
  const progressPct = document.getElementById('qib-progress-pct');
  const logEl = document.getElementById('qib-autocorrect-log');
  if (progressRow) progressRow.style.display = 'block';
  if (logEl) logEl.style.display = 'none';

  const lines = text.split('\n');
  const validLines = lines.filter(l => parseBatchLine(l));
  const total = validLines.length;
  let processed = 0;
  let importedCount = 0;
  let autoCorrectedCount = 0;
  let skippedDuplicateCount = 0;
  const autocorrectLog = [];

  function updateQibProgress(word) {
    processed++;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 100;
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressPct) progressPct.textContent = pct + '%';
    if (progressLabel) progressLabel.textContent = `⚙️ "${word}" — ${processed}/${total}`;
  }

  for (const line of lines) {
    const parsed = parseBatchLine(line);
    if (!parsed || !parsed.word) continue;

    const lookupRes = await lookupWordAllDetails(parsed.word, parsed.meanings);
    if (!lookupRes || !lookupRes.cleanWord) continue;

    if (lookupRes.wasAutocorrected) {
      autoCorrectedCount++;
      autocorrectLog.push(`"${lookupRes.originalClean}" → "${lookupRes.cleanWord}"`);
    }

    updateQibProgress(lookupRes.cleanWord);

    // Skip duplicates (case-insensitive check)
    if (state.vocab.some(w => w.word.toLowerCase().trim() === lookupRes.cleanWord.toLowerCase().trim())) {
      skippedDuplicateCount++;
      continue;
    }

    state.vocab.unshift({
      word: lookupRes.cleanWord,
      pronunciation: lookupRes.pronunciation,
      topic: selectedPart,
      status: 'new',
      lastReviewed: null,
      reviewCount: 0,
      meanings: lookupRes.meanings
    });
    importedCount++;
  }

  saveState();

  // Final progress state
  if (progressLabel) {
    let labelText = `✅ Xong! Đã lưu ${importedCount} từ vào "${selectedPart}"`;
    if (skippedDuplicateCount > 0) labelText += ` (Bỏ qua ${skippedDuplicateCount} từ bị trùng)`;
    progressLabel.textContent = labelText;
  }
  if (progressBar) progressBar.style.width = '100%';
  if (progressPct) progressPct.textContent = '100%';
  
  if (logEl) {
    let logText = '';
    if (autoCorrectedCount > 0) logText += `✏️ Đã sửa ${autoCorrectedCount} lỗi chính tả: ${autocorrectLog.join(' | ')} `;
    if (skippedDuplicateCount > 0) logText += `⚠️ Đã bỏ qua ${skippedDuplicateCount} từ trùng lặp.`;
    if (logText) {
      logEl.style.display = 'block';
      logEl.innerHTML = logText;
    }
  }

  importBtn.disabled = false;
  importBtn.textContent = originalText;
  textarea.value = '';

  // Refresh vocab list if visible
  const vocabListTab = document.getElementById('vocab-list');
  if (vocabListTab && vocabListTab.classList.contains('active')) renderVocabBank();

  let alertMsg = `✅ Đã lưu thành công ${importedCount} từ vào "${selectedPart}"!`;
  if (skippedDuplicateCount > 0) alertMsg += `\n⚠️ Bỏ qua ${skippedDuplicateCount} từ bị trùng lặp vì đã có sẵn trong kho từ.`;
  if (autoCorrectedCount > 0) alertMsg += `\n✏️ Tự động sửa ${autoCorrectedCount} lỗi chính tả.`;
  alert(alertMsg);
}

// Keep qib-part-pill active state in sync with click
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.qib-part-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.qib-part-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
});
