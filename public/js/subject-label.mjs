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
