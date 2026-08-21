// 全局记忆主角称呼：展示层统一使用，内部数据仍保留 TA 语义。
export const DEFAULT_SUBJECT_LABEL = 'TA';
export const SUBJECT_LABEL_MAX_LENGTH = 30;

export function normalizeSubjectLabel(value) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, SUBJECT_LABEL_MAX_LENGTH) : '';
  return normalized || DEFAULT_SUBJECT_LABEL;
}

export function subjectLabelFromConfig(config) {
  return normalizeSubjectLabel(config && config.subjectName);
}

// 随手记创建愿望时写入的来源也要使用展示称呼，避免新旧文案不一致。
export function quickWishSourceFromConfig(config) {
  return `${subjectLabelFromConfig(config)}随口说的`;
}
