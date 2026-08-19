// AI 问答：跟"最懂你们的大脑"聊天
import { el, get, post, toast, store } from '../core.js';

const SUGGESTIONS = [
  'TA对什么过敏？',
  '最近有什么生日或纪念日？',
  '下次送TA什么礼物好？',
  '我们还欠彼此哪些承诺？',
  'TA最近随口说过想要什么？',
  '推荐一个这周末的约会'
];
const HISTORY_KEY = 'vault_chat_history';

let chat = [];
let sending = false;

export async function render(container) {
  container.innerHTML = '';
  const ai = store.data.ai || await get('/api/ask/status').catch(() => null);
  if (!ai || !ai.configured) {
    container.append(el('div', { class: 'page' },
      el('div', { class: 'empty' },
        el('div', { class: 'empty-icon', text: '🤖' }),
        el('p', { html: 'AI 还没配置。到右上角 <b>⚙ 设置 → AI 问答</b> 选一个供应商、填上 API Key 就能用了。' }))));
    return;
  }

  chat = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');

  const list = el('div', { class: 'chat-list' });
  const input = el('input', { type: 'text', placeholder: '问点什么… 比如：TA的鞋码是多少？' });
  const sendBtn = el('button', { class: 'primary-btn', text: '发送' });

  const renderList = () => {
    list.innerHTML = '';
    if (!chat.length) {
      list.append(el('div', { class: 'chat-suggest' },
        el('p', { style: 'font-size:13px;color:var(--muted);width:100%', text: '试试这些：' }),
        ...SUGGESTIONS.map((s) => el('button', { text: s, onclick: () => { input.value = s; send(); } })),
        el('p', { style: 'font-size:12px;color:var(--muted);width:100%;margin-top:6px', text: '💡 也可以直接告诉 TA 新信息，比如"TA说想要一台胶片相机""TA不喜欢吃香菜"——我会帮你记进对应模块' })));
    }
    for (const m of chat) {
      list.append(el('div', { class: 'chat-bubble ' + (m.role === 'user' ? 'user' : 'ai' + (m.error ? ' error' : '')), text: m.content }));
    }
    list.scrollTop = list.scrollHeight;
  };

  const send = async () => {
    const q = input.value.trim();
    if (!q || sending) return;
    input.value = '';
    sending = true;
    sendBtn.disabled = true;
    chat.push({ role: 'user', content: q });
    const thinking = el('div', { class: 'chat-thinking', text: '正在翻记忆库…' });
    list.append(el('div', { class: 'chat-bubble user', text: q }), thinking);
    list.scrollTop = list.scrollHeight;
    try {
      const r = await post('/api/ask', { messages: chat.filter((m) => !m.error).slice(-20) });
      chat.push({ role: 'assistant', content: r.answer });
      // 本次对话 AI 通过工具真实写入记忆库的条目，提示用户
      for (const w of r.written || []) {
        const moduleName = { preferences: '偏好', events: '大事记', wishes: '愿望', people: '人名', gifts: '礼物' }[w.module] || w.module;
        toast(`已记入「${moduleName}」：${w.title} 💕`, 'ok');
      }
    } catch (e) {
      chat.push({ role: 'assistant', content: '出错了：' + e.message, error: true });
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(chat.slice(-100)));
    thinking.remove();
    sending = false;
    sendBtn.disabled = false;
    renderList();
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  container.append(el('div', { class: 'chat-wrap' },
    el('div', { class: 'chat-head' },
      el('span', { class: 'chat-model', text: `🤖 ${ai.provider} · ${ai.model} · 读得懂这里所有的记忆，也能帮你记下新信息` }),
      chat.length ? el('button', {
        class: 'ghost-btn', style: 'padding:5px 14px;font-size:12px', text: '清空对话', onclick: () => {
          if (!confirm('清空聊天记录？')) return;
          chat = [];
          localStorage.removeItem(HISTORY_KEY);
          renderList();
        }
      }) : null),
    list,
    el('div', { class: 'chat-input-bar' }, input, sendBtn)));
  renderList();
  setTimeout(() => input.focus(), 100);
}
