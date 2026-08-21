// 人物关系的展示投影：图和清单共用，确保来源、目标、方向规则始终一致。

const GROUPS = ['家人', '朋友', '同事', '其他'];

function disambiguatedLabels(people) {
  const groups = new Map();
  for (const person of people) {
    const name = typeof person.name === 'string' ? person.name : '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(person);
  }
  const labels = new Map();
  const marks = ['①', '②', '③', '④', '⑤'];
  for (const group of groups.values()) {
    const sorted = group.slice().sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
    sorted.forEach((person, index) => {
      labels.set(person.id, group.length > 1 ? `${person.name || '未命名'}${marks[index] || `(${index + 1})`}` : (person.name || '未命名'));
    });
  }
  return labels;
}

function pairKey(a, b) {
  return [String(a), String(b)].sort().join('\u0000');
}

function normalizeRelationNote(value) {
  const note = typeof value === 'string' ? value.trim() : '';
  return /^(null|undefined)$/i.test(note) ? '' : note;
}

function assignCurves(edges) {
  const pairs = new Map();
  for (const edge of edges) {
    if (edge.kind === 'ta') continue;
    const key = pairKey(edge.from, edge.to);
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(edge);
  }
  for (const pair of pairs.values()) {
    const directions = new Map();
    for (const edge of pair) {
      const key = `${edge.from}\u0000${edge.to}`;
      if (!directions.has(key)) directions.set(key, []);
      directions.get(key).push(edge);
    }
    const isBidirectional = directions.size > 1;
    for (const [directionIndex, directionEdges] of [...directions.values()].entries()) {
      const sign = isBidirectional ? (directionIndex === 0 ? 1 : -1) : 1;
      directionEdges.forEach((edge, index) => {
        edge.curve = sign * (isBidirectional ? 0.9 + index * 0.35 : (index - (directionEdges.length - 1) / 2) * 0.7);
      });
    }
  }
}

/**
 * Build the single source of truth used by the relation graph and relation list.
 * relations[{toId,type,bidirectional?}] means source person -> target person;
 * bidirectional=true means the relation is mutual and is rendered as source ↔ target.
 * person.relation means subject -> person: the relationship of the memory subject to that person.
 */
export function buildRelationModel(people = [], filterGroup = 'all', subjectLabel = 'TA') {
  const centerLabel = typeof subjectLabel === 'string' && subjectLabel.trim() ? subjectLabel.trim() : 'TA';
  const allPeople = Array.isArray(people) ? people.filter((person) => person && person.id) : [];
  const labels = disambiguatedLabels(allPeople);
  const visiblePeople = filterGroup === 'all'
    ? allPeople
    : allPeople.filter((person) => person.group === filterGroup);
  const visibleIds = new Set(visiblePeople.map((person) => person.id));
  const byId = new Map(allPeople.map((person) => [person.id, person]));
  const nodes = [{ id: 'TA', label: centerLabel, group: 'TA', fixed: true, center: true }];
  const edges = [];

  for (const person of visiblePeople) {
    nodes.push({ id: person.id, label: labels.get(person.id), group: person.group || '其他' });
    const relation = typeof person.relation === 'string' ? person.relation.trim() : '';
    if (relation) {
      edges.push({
        id: `ta:${person.id}`,
        from: 'TA',
        to: person.id,
        label: relation,
        note: '',
        kind: 'ta',
        directed: true,
        sourceLabel: centerLabel,
        targetLabel: labels.get(person.id)
      });
    }
  }

  for (const person of visiblePeople) {
    const relations = Array.isArray(person.relations) ? person.relations : [];
    relations.forEach((relation, index) => {
      const target = byId.get(relation && relation.toId);
      // 分组筛选时只展示两个端点都在当前分组内的关系。
      if (!target || !visibleIds.has(target.id)) return;
      const bidirectional = relation && relation.bidirectional === true;
      edges.push({
        id: `relation:${person.id}:${index}:${target.id}`,
        from: person.id,
        to: target.id,
        label: typeof relation.type === 'string' ? relation.type : '',
        note: normalizeRelationNote(relation && relation.note),
        kind: 'person',
        directed: !bidirectional,
        bidirectional,
        sourceLabel: labels.get(person.id),
        targetLabel: labels.get(target.id)
      });
    });
  }
  assignCurves(edges);
  return {
    nodes,
    edges,
    filterGroup,
    filterHint: filterGroup === 'all' ? '' : `当前仅显示“${filterGroup}”组内关系`
  };
}

export function relationDetail(edge) {
  if (!edge) return '';
  const type = edge.label || '未填写关系';
  const symbol = edge.bidirectional || edge.directed === false ? '↔' : '→';
  return `${edge.sourceLabel} ${symbol} ${edge.targetLabel}：${type}`;
}

// 卡片和编辑页都需要看到“自己发出”的关系，以及“对方发出但标为双向”的关系。
// 返回图中同一条边，不复制数据，也不额外落盘。
export function personRelationEdges(model, personId) {
  if (!model || !personId) return [];
  return (model.edges || []).filter((edge) => edge.kind === 'person'
    && (edge.from === personId || (edge.bidirectional === true && edge.to === personId)));
}

export { GROUPS };
