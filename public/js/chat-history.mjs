// AI 聊天记录属于用户私有内容：localStorage 必须按会话主体分区。
const LEGACY_KEY = 'vault_chat_history';
const KEY_PREFIX = 'vault_chat_history_v2:';
const MAX_MESSAGES = 100;

export function normalizeChatScope(scope) {
  const value = typeof scope === 'string' ? scope.trim() : '';
  return value || 'anonymous';
}

export function chatHistoryKey(scope) {
  return KEY_PREFIX + encodeURIComponent(normalizeChatScope(scope));
}

function validMessages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
    .slice(-MAX_MESSAGES);
}

export function loadChatHistory(storage, scope) {
  try {
    const raw = storage.getItem(chatHistoryKey(scope));
    return raw ? validMessages(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveChatHistory(storage, scope, messages) {
  try {
    storage.setItem(chatHistoryKey(scope), JSON.stringify(validMessages(messages)));
  } catch {
    // 隐私模式下 localStorage 可能不可写；聊天仍可在当前页面内使用。
  }
}

export function clearChatHistory(storage, scope) {
  try { storage.removeItem(chatHistoryKey(scope)); } catch {}
}

// 旧版只有单一 key。本地单用户可以把旧记录安全迁移；多用户模式无法判断
// 旧记录属于谁，直接删除，避免下一个登录账号看到上一个人的聊天。
export function initializeChatHistoryStorage(storage, scope) {
  try {
    const normalized = normalizeChatScope(scope);
    const key = chatHistoryKey(normalized);
    if (normalized === 'local' && !storage.getItem(key)) {
      const legacy = storage.getItem(LEGACY_KEY);
      if (legacy) {
        const messages = validMessages(JSON.parse(legacy));
        if (messages.length) storage.setItem(key, JSON.stringify(messages));
      }
    }
    storage.removeItem(LEGACY_KEY);
  } catch {
    // 旧内容损坏时直接丢弃，不影响应用启动。
    try { storage.removeItem(LEGACY_KEY); } catch {}
  }
}
