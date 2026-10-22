// 服务端领域枚举：内容校验和 AI 工具共用，避免它们各自维护一份白名单。
const EVENT_TYPES = ['里程碑', '约会', '旅行', '争吵与和解', '承诺', '其他'];
const WISH_STATUSES = ['想要', '计划', '已实现'];
const WISH_PRIORITIES = ['高', '中', '低'];
const GIFT_DIRECTIONS = ['送给TA', 'TA送我'];
const PREF_POLARITIES = ['喜欢', '不喜欢'];
const PREF_CATEGORIES = ['吃', '喝', '穿', '用', '玩', '其他'];
const PEOPLE_GROUPS = ['家人', '朋友', '同事', '其他'];

module.exports = { EVENT_TYPES, WISH_STATUSES, WISH_PRIORITIES, GIFT_DIRECTIONS, PREF_POLARITIES, PREF_CATEGORIES, PEOPLE_GROUPS };