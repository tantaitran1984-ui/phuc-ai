const STORAGE_KEY = 'phuc-ai-history';
const LEGACY_MIGRATION_KEY = 'phuc-ai-history-migrated';
const THEME_KEY = 'phuc-ai-theme';
const CHAT_MODEL = 'gemini-3-flash-preview';

const state = {
  sessions: [],
  currentSessionId: null,
  attachments: [],
  username: null,
  authMode: 'login',
};

const appShell = document.querySelector('.app-shell');
const authOverlay = document.querySelector('#auth-overlay');
const authForm = document.querySelector('#auth-form');
const authTitle = document.querySelector('#auth-title');
const authUsername = document.querySelector('#auth-username');
const authPassword = document.querySelector('#auth-password');
const authError = document.querySelector('#auth-error');
const authSubmit = document.querySelector('#auth-submit');
const authSwitchCopy = document.querySelector('#auth-switch-copy');
const authSwitch = document.querySelector('#auth-switch');
const passwordToggle = document.querySelector('#password-toggle');
const usernameLabel = document.querySelector('#username-label');
const logoutBtn = document.querySelector('#logout-btn');
const themeToggle = document.querySelector('#theme-toggle');
const messagesViewport = document.querySelector('#messages');
const messageContainer = document.querySelector('#message-feed');
const questionNav = document.querySelector('#question-nav');
const historyList = document.querySelector('#history-list');
const historySearch = document.querySelector('#history-search');
const promptInput = document.querySelector('#prompt-input');
const newChatBtn = document.querySelector('#new-chat');
const sidebarToggle = document.querySelector('#sidebar-toggle');
const sidebarScrim = document.querySelector('#sidebar-scrim');
const sendBtn = document.querySelector('#send-btn');
const uploadImageBtn = document.querySelector('#upload-image-btn');
const imageUploadInput = document.querySelector('#image-upload');
const attachmentPreview = document.querySelector('#attachment-preview');
const exportBtn = document.querySelector('#export-chat');
let legacySessions = loadSessions(STORAGE_KEY);
let historySyncQueue = Promise.resolve();
let lastHeartAt = 0;

init();

async function init() {
  bindEvents();
  bindAuthEvents();
  applyTheme(localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light');
  await restoreAuthentication();
}

function bindEvents() {
  newChatBtn.addEventListener('click', () => {
    historySearch.value = '';
    createNewSession();
    renderHistory();
    renderMessages();
    closeMobileSidebar();
    promptInput.focus();
  });

  historySearch.addEventListener('input', renderHistory);
  sidebarToggle.addEventListener('click', toggleSidebar);
  sidebarScrim.addEventListener('click', closeMobileSidebar);
  messagesViewport.addEventListener('scroll', updateActiveQuestionMarker, { passive: true });

  sendBtn.addEventListener('click', sendCurrentMessage);
  promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });
  promptInput.addEventListener('input', resizePromptInput);

  uploadImageBtn.addEventListener('click', () => imageUploadInput.click());
  imageUploadInput.addEventListener('change', handleFileSelection);
  exportBtn.addEventListener('click', exportChat);
  logoutBtn.addEventListener('click', logout);
  themeToggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
  });

  window.addEventListener('pointerdown', addHeartTrail, { passive: true });
  window.addEventListener('pointermove', addHeartTrail, { passive: true });
}

function bindAuthEvents() {
  authForm.addEventListener('submit', submitAuthForm);
  authSwitch.addEventListener('click', () => {
    setAuthMode(state.authMode === 'login' ? 'register' : 'login');
  });
  passwordToggle.addEventListener('click', () => {
    const isVisible = authPassword.type === 'text';
    authPassword.type = isVisible ? 'password' : 'text';
    passwordToggle.textContent = isVisible ? 'Hiện' : 'Ẩn';
    passwordToggle.setAttribute('aria-label', isVisible ? 'Hiện mật khẩu' : 'Ẩn mật khẩu');
  });
}

async function restoreAuthentication() {
  try {
    const response = await fetch('/api/auth/me');
    const data = await response.json();
    if (data.authenticated) {
      await activateAccount(data.username);
    } else {
      showAuthOverlay();
    }
  } catch (error) {
    showAuthOverlay();
    showAuthError('Không kết nối được máy chủ. Hãy thử tải lại trang.');
  }
}

function showAuthOverlay() {
  appShell.hidden = true;
  authOverlay.hidden = false;
  authUsername.focus();
}

function setAuthMode(mode) {
  state.authMode = mode;
  authError.hidden = true;
  authForm.reset();
  const registering = mode === 'register';
  authTitle.textContent = registering ? 'Đăng ký tài khoản' : 'Đăng nhập tài khoản';
  authSubmit.textContent = registering ? 'Tạo tài khoản' : 'Đăng nhập';
  authSwitchCopy.textContent = registering ? 'Đã có tài khoản?' : 'Chưa có tài khoản?';
  authSwitch.textContent = registering ? 'Đăng nhập ngay' : 'Đăng ký ngay';
  authPassword.autocomplete = registering ? 'new-password' : 'current-password';
  authPassword.type = 'password';
  passwordToggle.textContent = 'Hiện';
  passwordToggle.setAttribute('aria-label', 'Hiện mật khẩu');
}

function showAuthError(message) {
  authError.textContent = message;
  authError.hidden = false;
}

async function submitAuthForm(event) {
  event.preventDefault();
  authError.hidden = true;
  authSubmit.disabled = true;
  const endpoint = state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: authUsername.value, password: authPassword.value }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Không thể đăng nhập.');
    await activateAccount(data.username);
  } catch (error) {
    showAuthError(error.message || 'Không thể kết nối máy chủ.');
  } finally {
    authSubmit.disabled = false;
  }
}

async function activateAccount(username) {
  const response = await fetch('/api/history');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không tải được lịch sử hội thoại.');

  const accountKey = getUserHistoryKey(username);
  const cachedSessions = loadSessions(accountKey);
  const remoteSessions = Array.isArray(data.sessions) ? data.sessions : [];

  state.username = username;
  state.sessions = remoteSessions.length ? remoteSessions : cachedSessions;
  const shouldClaimLegacy = legacySessions.length > 0 && localStorage.getItem(LEGACY_MIGRATION_KEY) !== '1';
  if (shouldClaimLegacy) {
    const existingIds = new Set(state.sessions.map((item) => item.id));
    state.sessions.push(...legacySessions.filter((item) => !existingIds.has(item.id)));
    state.sessions.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
    localStorage.setItem(LEGACY_MIGRATION_KEY, '1');
    localStorage.removeItem(STORAGE_KEY);
    legacySessions = [];
  }

  authOverlay.hidden = true;
  appShell.hidden = false;
  usernameLabel.textContent = username;
  if (!state.sessions.length) createNewSession();
  else state.currentSessionId = state.sessions[0].id;
  saveSessions();
  renderHistory();
  renderMessages();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isDark = theme === 'dark';
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.setAttribute('aria-label', isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối');
  themeToggle.querySelector('.theme-icon').textContent = isDark ? '☀' : '☾';
  themeToggle.querySelector('.theme-label').textContent = isDark ? 'Giao diện sáng' : 'Giao diện tối';
}

function getUserHistoryKey(username) {
  return `${STORAGE_KEY}:${encodeURIComponent(username.toLowerCase())}`;
}

async function logout() {
  await historySyncQueue.catch(() => {});
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  state.username = null;
  state.sessions = [];
  state.currentSessionId = null;
  state.attachments = [];
  promptInput.value = '';
  renderAttachmentPreview();
  setAuthMode('login');
  showAuthOverlay();
}

function addHeartTrail(event) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const now = performance.now();
  if (now - lastHeartAt < 90) return;
  lastHeartAt = now;

  const trail = document.createElement('span');
  trail.className = 'heart-trail';
  trail.innerHTML = '<span class="heart-trail-symbol">♥</span><span class="heart-sparkle">✦</span>';
  trail.style.left = `${event.clientX}px`;
  trail.style.top = `${event.clientY}px`;
  trail.style.setProperty('--drift', `${(Math.random() - 0.5) * 20}px`);
  trail.addEventListener('animationend', () => trail.remove(), { once: true });
  document.body.appendChild(trail);
}

function resizePromptInput() {
  promptInput.style.height = 'auto';
  const height = Math.min(Math.max(promptInput.scrollHeight, 58), 220);
  promptInput.style.height = `${height}px`;
  promptInput.style.overflowY = promptInput.scrollHeight > 220 ? 'auto' : 'hidden';
}

function loadSessions(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(parsed) && parsed.length ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveSessions() {
  if (!state.username) return historySyncQueue;

  const sessionsJson = JSON.stringify(state.sessions);
  localStorage.setItem(getUserHistoryKey(state.username), sessionsJson);
  historySyncQueue = historySyncQueue
    .catch(() => {})
    .then(async () => {
      const response = await fetch('/api/history', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: JSON.parse(sessionsJson) }),
      });
      if (!response.ok) throw new Error('Không sao lưu được lịch sử.');
    });
  return historySyncQueue;
}

function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createNewSession() {
  const session = {
    id: generateId('chat'),
    title: 'Hội thoại mới',
    messages: [],
    createdAt: Date.now(),
  };

  state.sessions.unshift(session);
  state.currentSessionId = session.id;
  saveSessions();
}

function getCurrentSession() {
  return state.sessions.find((session) => session.id === state.currentSessionId) || state.sessions[0];
}

function renderHistory() {
  historyList.innerHTML = '';

  if (!state.sessions.length) {
    createNewSession();
  }

  const searchTerm = historySearch.value.trim().toLocaleLowerCase();
  const matchingSessions = state.sessions.filter((session) => {
    if (!searchTerm) return true;
    const content = [session.title, ...(session.messages || []).map((message) => message.text || '')]
      .join(' ')
      .toLocaleLowerCase();
    return content.includes(searchTerm);
  });

  matchingSessions.forEach((session) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    if (session.id === state.currentSessionId) {
      item.classList.add('active');
    }

    const matchedMessage = searchTerm
      ? [...session.messages].reverse().find((message) => (message.text || '').toLocaleLowerCase().includes(searchTerm))
      : null;
    const preview = matchedMessage?.text || session.title || (session.messages.length
      ? session.messages[session.messages.length - 1].text || 'Ảnh đính kèm'
      : 'Bắt đầu cuộc trò chuyện');

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'history-label';
    label.textContent = `${preview.slice(0, 72)}${preview.length > 72 ? '…' : ''}`;
    label.title = preview;
    label.addEventListener('click', () => {
      state.currentSessionId = session.id;
      historySearch.value = '';
      renderHistory();
      renderMessages();
      closeMobileSidebar();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'history-delete';
    deleteBtn.setAttribute('aria-label', 'Xóa hội thoại');
    deleteBtn.innerHTML = '🗑';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteSession(session.id);
    });

    item.appendChild(label);
    item.appendChild(deleteBtn);
    historyList.appendChild(item);
  });

  if (!matchingSessions.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = 'Không tìm thấy hội thoại';
    historyList.appendChild(empty);
  }
}

function toggleSidebar() {
  if (window.matchMedia('(max-width: 560px)').matches) {
    const isOpen = appShell.classList.toggle('sidebar-open');
    sidebarToggle.setAttribute('aria-expanded', String(isOpen));
    sidebarToggle.setAttribute('aria-label', isOpen ? 'Đóng danh sách hội thoại' : 'Mở danh sách hội thoại');
    sidebarScrim.hidden = !isOpen;
    return;
  }

  const isCollapsed = appShell.classList.toggle('sidebar-collapsed');
  sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
  sidebarToggle.setAttribute('aria-label', isCollapsed ? 'Mở danh sách hội thoại' : 'Thu gọn danh sách hội thoại');
}

function closeMobileSidebar() {
  if (!window.matchMedia('(max-width: 560px)').matches) return;
  appShell.classList.remove('sidebar-open');
  sidebarToggle.setAttribute('aria-expanded', 'false');
  sidebarToggle.setAttribute('aria-label', 'Mở danh sách hội thoại');
  sidebarScrim.hidden = true;
}

function deleteSession(sessionId) {
  state.sessions = state.sessions.filter((session) => session.id !== sessionId);

  if (!state.sessions.length) {
    createNewSession();
  }

  if (!state.sessions.some((session) => session.id === state.currentSessionId)) {
    state.currentSessionId = state.sessions[0].id;
  }

  saveSessions();
  renderHistory();
  renderMessages();
}

function renderMessages() {
  const session = getCurrentSession();
  const messages = session?.messages || [];

  if (!messages.length) {
    messageContainer.innerHTML = `
      <div class="empty-state">
        <h2>Phúc AI sẵn sàng</h2>
        <p>Hỏi tôi về công việc, lập kế hoạch, viết nội dung, phân tích, hoặc tối ưu ý tưởng. Tôi luôn sẵn sàng giúp bạn.</p>
      </div>
    `;
    renderQuestionNav([]);
    return;
  }

  messageContainer.innerHTML = messages
    .map((msg) => {
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      const meta = role === 'assistant' ? 'Phúc AI' : 'Bạn';

      if (msg.isThinking) {
        return `
          <div class="message-row assistant" data-message-role="assistant">
            <div class="message-bubble">
              <div class="message-meta"><span>${meta}</span></div>
              <div class="typing-indicator">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="message-row ${role}" data-message-id="${escapeHtml(msg.id || '')}" data-message-role="${role}">
          <div class="message-bubble">
            <div class="message-meta"><span>${meta}</span></div>
            ${msg.imageUrl ? `<div class="generated-image-wrap"><img src="${msg.imageUrl}" alt="Generated art" /></div>` : ''}
            <div>${formatTextWithLineBreaks(msg.text || '')}</div>
          </div>
        </div>
      `;
    })
    .join('');

  renderQuestionNav(messages.filter((message) => message.role === 'user'));
  messagesViewport.scrollTop = messagesViewport.scrollHeight;
  requestAnimationFrame(updateActiveQuestionMarker);
}

function renderQuestionNav(questions) {
  if (!questions.length) {
    questionNav.innerHTML = '';
    return;
  }

  questionNav.innerHTML = `
    <div class="question-nav-list">
      ${questions.map((question, index) => {
        const label = (question.text || 'Câu hỏi có đính kèm ảnh').trim();
        return `
          <button class="question-nav-item${index === questions.length - 1 ? ' active' : ''}"
            type="button" aria-label="Cuộn đến câu hỏi ${index + 1}: ${escapeHtml(label)}"
            title="${escapeHtml(label.slice(0, 180))}">
            <span class="question-tooltip">${escapeHtml(label)}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;

  const buttons = questionNav.querySelectorAll('.question-nav-item');
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      buttons.forEach((item) => item.classList.remove('show-tooltip'));
      button.classList.add('show-tooltip');
      window.setTimeout(() => button.classList.remove('show-tooltip'), 2400);

      const target = messageContainer.querySelectorAll('[data-message-role="user"]')[index];
      if (!target) return;

      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      buttons.forEach((item) => {
        item.classList.toggle('active', item === button);
        if (item === button) item.setAttribute('aria-current', 'true');
        else item.removeAttribute('aria-current');
      });
    });
  });
}

function updateActiveQuestionMarker() {
  const questions = [...messageContainer.querySelectorAll('[data-message-role="user"]')];
  const buttons = [...questionNav.querySelectorAll('.question-nav-item')];
  if (!questions.length || !buttons.length) return;

  const focusY = messagesViewport.getBoundingClientRect().top + messagesViewport.clientHeight * 0.44;
  let closestIndex = 0;
  let closestDistance = Infinity;
  questions.forEach((question, index) => {
    const distance = Math.abs(question.getBoundingClientRect().top - focusY);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });

  buttons.forEach((button, index) => {
    const isActive = index === closestIndex;
    button.classList.toggle('active', isActive);
    if (isActive) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
}

async function sendCurrentMessage() {
  const session = getCurrentSession();
  const text = promptInput.value.trim();

  if (!text && !state.attachments.length) {
    return;
  }

  const userMessage = {
    id: generateId('user'),
    role: 'user',
    text,
    attachments: [...state.attachments],
    createdAt: Date.now(),
  };

  session.messages.push(userMessage);
  const currentTitle = text ? text.slice(0, 30) : 'Hội thoại mới';
  session.title = currentTitle || session.title;
  saveSessions();

  promptInput.value = '';
  resizePromptInput();
  state.attachments = [];
  renderAttachmentPreview();
  renderHistory();
  renderMessages();

  const thinkingId = generateId('thinking');
  session.messages.push({ id: thinkingId, role: 'assistant', text: '', isThinking: true, createdAt: Date.now() });
  saveSessions();
  renderMessages();

  const payloadMessages = session.messages.filter((message) => !message.isThinking).map((message) => ({
    role: message.role,
    text: message.text || '',
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
  }));

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: payloadMessages,
      }),
    });

    const data = await response.json();
    const reply = data.reply || data.error || 'Không nhận được phản hồi từ model đã chọn.';

    const thinkingIndex = session.messages.findIndex((message) => message.id === thinkingId);
    if (thinkingIndex !== -1) {
      session.messages[thinkingIndex] = {
        id: generateId('assistant'),
        role: 'assistant',
        text: reply,
        model: data.model || CHAT_MODEL,
        attachments: [],
        createdAt: Date.now(),
      };
    } else {
      session.messages.push({ id: generateId('assistant'), role: 'assistant', text: reply, model: data.model || CHAT_MODEL, attachments: [], createdAt: Date.now() });
    }

    saveSessions();
    renderHistory();
    renderMessages();
  } catch (error) {
    const thinkingIndex = session.messages.findIndex((message) => message.id === thinkingId);
    if (thinkingIndex !== -1) {
      session.messages[thinkingIndex] = {
        id: generateId('assistant'),
        role: 'assistant',
        text: 'Không kết nối được máy chủ Phúc AI. Hãy kiểm tra ứng dụng đang chạy rồi thử lại.',
        model: CHAT_MODEL,
        attachments: [],
        createdAt: Date.now(),
      };
    }
    saveSessions();
    renderHistory();
    renderMessages();
  }
}

async function handleFileSelection(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const dataUrl = await toBase64(file);
  state.attachments.push({
    type: 'image',
    dataUrl,
    name: file.name,
    mimeType: file.type || 'image/png',
  });

  renderAttachmentPreview();
  imageUploadInput.value = '';
}

function renderAttachmentPreview() {
  if (!state.attachments.length) {
    attachmentPreview.innerHTML = '';
    return;
  }

  attachmentPreview.innerHTML = state.attachments
    .map(
      (attachment, index) => `
        <div class="attachment-chip">
          <img src="${attachment.dataUrl}" alt="attachment-${index}" />
          <span>${escapeHtml(attachment.name || 'image')}</span>
          <button class="remove-chip" type="button" data-index="${index}">×</button>
        </div>
      `
    )
    .join('');

  attachmentPreview.querySelectorAll('.remove-chip').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      state.attachments.splice(index, 1);
      renderAttachmentPreview();
    });
  });
}

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Không đọc được ảnh'));
    reader.readAsDataURL(file);
  });
}

function exportChat() {
  const session = getCurrentSession();
  const payload = session.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'user' ? 'Bạn' : 'Phúc AI'}: ${message.text || '[Hình ảnh]'}`)
    .join('\n\n');

  const blob = new Blob([payload], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'phuc-ai-chat.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatTextWithLineBreaks(text) {
  return escapeHtml(text)
    .replace(/^#{1,3}\s+(.+)$/gm, '<strong class="message-heading">$1</strong>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
