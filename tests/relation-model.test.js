const test = require('node:test');
const assert = require('node:assert/strict');

const modelPromise = import('../public/js/relation-model.mjs');

const samplePeople = () => [
  { id: 'aaa11111-1111-4111-8111-111111111111', name: '李阿姨', relation: '妈妈', group: '家人', relations: [
    { toId: 'bbb22222-2222-4222-8222-222222222222', type: '同事', note: '同一家公司' }
  ] },
  { id: 'bbb22222-2222-4222-8222-222222222222', name: '王叔叔', relation: '邻居', group: '其他', relations: [
    { toId: 'aaa11111-1111-4111-8111-111111111111', type: '朋友' }
  ] },
  { id: 'ccc33333-3333-4333-8333-333333333333', name: '王叔叔', relation: '', group: '同事', relations: [] }
];

test('关系投影以 TA 为中心，并保留人物关系方向', () => {
  return modelPromise.then(({ buildRelationModel, relationDetail }) => {
  const model = buildRelationModel(samplePeople());
  const personEdges = model.edges.filter((edge) => edge.kind === 'person');
  assert.equal(personEdges.length, 2);
  assert.deepEqual(personEdges.map((edge) => [edge.from, edge.to, edge.label]), [
    ['aaa11111-1111-4111-8111-111111111111', 'bbb22222-2222-4222-8222-222222222222', '同事'],
    ['bbb22222-2222-4222-8222-222222222222', 'aaa11111-1111-4111-8111-111111111111', '朋友']
  ]);
  assert.notEqual(personEdges[0].curve, 0);
  assert.equal(personEdges[0].curve, -personEdges[1].curve);
  assert.equal(personEdges[0].note, '同一家公司');
  const taEdge = model.edges.find((edge) => edge.kind === 'ta' && edge.targetLabel === '李阿姨');
  assert.equal(taEdge.label, '妈妈');
  assert.equal(taEdge.from, 'TA');
  assert.equal(taEdge.to, 'aaa11111-1111-4111-8111-111111111111');
  assert.equal(taEdge.directed, true);
  assert.equal(relationDetail(taEdge), 'TA → 李阿姨：妈妈');
  });
});

test('同名人物按 ID 生成稳定标签，分组筛选不保留隐藏端点', () => {
  return modelPromise.then(({ buildRelationModel }) => {
  const model = buildRelationModel(samplePeople(), '家人');
  assert.deepEqual(model.nodes.map((node) => node.label), ['TA', '李阿姨']);
  assert.equal(model.edges.filter((edge) => edge.kind === 'person').length, 0);
  const all = buildRelationModel(samplePeople());
  const duplicateLabels = all.nodes.filter((node) => node.label.startsWith('王叔叔')).map((node) => node.label).sort();
  assert.deepEqual(duplicateLabels, ['王叔叔①', '王叔叔②']);
  });
});

test('双向关系使用 ↔、不绘制箭头，并清理空备注文本', () => {
  return modelPromise.then(({ buildRelationModel, relationDetail }) => {
    const model = buildRelationModel([
      { id: 'aaa11111-1111-4111-8111-111111111111', name: '哥哥', relation: '哥哥', group: '家人', relations: [
        { toId: 'bbb22222-2222-4222-8222-222222222222', type: '夫妻', bidirectional: true, note: ' null ' }
      ] },
      { id: 'bbb22222-2222-4222-8222-222222222222', name: '嫂子', relation: '嫂子', group: '家人', relations: [] }
    ]);
    const edge = model.edges.find((item) => item.kind === 'person');
    assert.equal(edge.bidirectional, true);
    assert.equal(edge.directed, false);
    assert.equal(edge.note, '');
    assert.equal(relationDetail(edge), '哥哥 ↔ 嫂子：夫妻');
  });
});
