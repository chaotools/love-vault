// HTML 布尔属性必须按 DOM property 写入；setAttribute(name, false) 仍然会变成 true。
export const BOOLEAN_PROPERTIES = new Set(['checked', 'disabled', 'hidden', 'selected', 'multiple', 'required', 'autofocus', 'open', 'inert']);

export function applyBooleanProperty(node, name, value) {
  if (!BOOLEAN_PROPERTIES.has(name)) return false;
  node[name] = Boolean(value);
  return true;
}
