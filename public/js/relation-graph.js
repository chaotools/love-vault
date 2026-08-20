// 自研力导向有向关系图（零依赖）。
// 边的语义是 source -> target；箭头指向 target，双向关系使用相反方向的弧线。

const GROUP_COLORS = {
  家人: '#e8a06a',
  朋友: '#6abf8a',
  同事: '#6ea8dc',
  其他: '#b08ad6',
  TA: '#e87b8e'
};

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

export class RelationGraph {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = opts.onNodeClick || (() => {});
    this.onNodeSelect = opts.onNodeSelect || (() => {});
    this.onNodeHover = opts.onNodeHover || (() => {});
    this.onEdgeSelect = opts.onEdgeSelect || (() => {});
    this.onEdgeHover = opts.onEdgeHover || (() => {});
    this.nodes = [];
    this.edges = [];
    this.running = false;
    this.rafId = null;
    this.dragged = null;
    this.dragStart = null;
    this.dragMoved = false;
    this.hovered = null;
    this.selectedNodeId = null;
    this.selectedEdgeId = null;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.panning = false;
    this.panStart = null;
    this.lastNodeClick = null;
    this.doubleClickDelay = 350;
    this.width = 0;
    this.height = 0;
    this.destroyed = false;

    // 力导向参数：弹簧、斥力、中心引力、阻尼和速度上限。
    this.springLength = 110;
    this.springK = 0.06;
    this.repulsion = 900;
    this.centralGravity = 0.02;
    this.damping = 0.85;
    this.maxVelocity = 30;
    this.minVelocity = 0.3;
    this._bindEvents();
  }

  _bindEvents() {
    const c = this.canvas;
    this.handlers = {
      pointerdown: (e) => this._onPointerDown(e),
      pointermove: (e) => this._onPointerMove(e),
      pointerup: (e) => this._onPointerUp(e),
      pointercancel: (e) => this._onPointerUp(e, true),
      wheel: (e) => this._onWheel(e),
      resize: () => {
        if (this.destroyed) return;
        this._resize();
        this._centerNodes();
        this._draw();
      }
    };
    c.addEventListener('pointerdown', this.handlers.pointerdown);
    window.addEventListener('pointermove', this.handlers.pointermove);
    window.addEventListener('pointerup', this.handlers.pointerup);
    window.addEventListener('pointercancel', this.handlers.pointercancel);
    c.addEventListener('wheel', this.handlers.wheel, { passive: false });
    window.addEventListener('resize', this.handlers.resize);
  }

  setData(nodes, edges) {
    this.nodes = nodes || [];
    this.edges = edges || [];
    this.selectedNodeId = null;
    this.selectedEdgeId = null;
    this.hovered = null;
    this.lastNodeClick = null;
    this._resize();
    this._layoutRadial();
    this.start();
  }

  _layoutRadial() {
    const center = this.nodes.find((node) => node.center) || null;
    const cx = this.width / 2;
    const cy = this.height / 2;
    if (center) {
      center.x = cx;
      center.y = cy;
      center.fixed = true;
      center.vx = 0;
      center.vy = 0;
    }

    const people = this.nodes.filter((node) => !node.center).slice();
    const directIds = new Set((center ? this.edges : [])
      .filter((edge) => edge.kind === 'ta' && edge.from === center.id)
      .map((edge) => edge.to));
    const direct = people.filter((node) => directIds.has(node.id));
    const extended = people.filter((node) => !directIds.has(node.id));
    const groupOrder = new Map([['家人', 0], ['朋友', 1], ['同事', 2], ['其他', 3]]);
    const sortNodes = (list) => list.sort((a, b) =>
      (groupOrder.get(a.group) ?? 9) - (groupOrder.get(b.group) ?? 9)
      || String(a.label || '').localeCompare(String(b.label || ''))
      || String(a.id).localeCompare(String(b.id)));
    const maxRadius = Math.max(120, Math.min(this.width, this.height) * 0.42);
    const ringRadius = (count, minimum) => Math.min(maxRadius, Math.max(minimum, count * 52 / (Math.PI * 2)));
    const placeRing = (list, radius, offset) => {
      sortNodes(list).forEach((node, index) => {
        const angle = offset + (index / Math.max(1, list.length)) * Math.PI * 2;
        node.x = cx + Math.cos(angle) * radius;
        node.y = cy + Math.sin(angle) * radius;
        node.fixed = false;
        node.vx = 0;
        node.vy = 0;
      });
    };

    if (direct.length) {
      const inner = ringRadius(direct.length, Math.min(150, maxRadius));
      placeRing(direct, inner, -Math.PI / 2);
      if (extended.length) placeRing(extended, Math.max(inner + 78, ringRadius(extended.length, inner + 78)), 0);
    } else {
      placeRing(extended, ringRadius(extended.length, Math.min(170, maxRadius)), -Math.PI / 2);
    }
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _centerNodes() {
    for (const node of this.nodes) {
      if (node.center) {
        node.x = this.width / 2;
        node.y = this.height / 2;
      }
    }
  }

  _toCanvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _worldToScreen(node) {
    return { x: (node.x + this.offsetX) * this.scale, y: (node.y + this.offsetY) * this.scale };
  }

  _screenToWorld(point) {
    return { x: point.x / this.scale - this.offsetX, y: point.y / this.scale - this.offsetY };
  }

  _findNode(id) {
    return this.nodes.find((node) => node.id === id) || null;
  }

  _hitNode(point) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const screen = this._worldToScreen(this.nodes[i]);
      if (Math.hypot(point.x - screen.x, point.y - screen.y) <= 24 * this.scale) return this.nodes[i];
    }
    return null;
  }

  _edgeGeometry(edge) {
    const source = this._findNode(edge.from);
    const target = this._findNode(edge.to);
    if (!source || !target) return null;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const curve = Number(edge.curve) || 0;
    if (!curve) return { source, target, control: null };
    const normalX = -dy / distance;
    const normalY = dx / distance;
    const bend = Math.min(90, Math.max(32, distance * 0.22)) * curve;
    return {
      source,
      target,
      control: {
        x: (source.x + target.x) / 2 + normalX * bend,
        y: (source.y + target.y) / 2 + normalY * bend
      }
    };
  }

  _edgePoint(geometry, t) {
    const { source, target, control } = geometry;
    if (!control) return { x: source.x + (target.x - source.x) * t, y: source.y + (target.y - source.y) * t };
    const rest = 1 - t;
    return {
      x: rest * rest * source.x + 2 * rest * t * control.x + t * t * target.x,
      y: rest * rest * source.y + 2 * rest * t * control.y + t * t * target.y
    };
  }

  _edgePoints(edge, count = 18) {
    const geometry = this._edgeGeometry(edge);
    if (!geometry) return [];
    return Array.from({ length: count + 1 }, (_, index) => this._worldToScreen(this._edgePoint(geometry, index / count)));
  }

  _hitEdge(point) {
    let best = null;
    let bestDistance = 11;
    for (const edge of this.edges) {
      const points = this._edgePoints(edge);
      for (let i = 1; i < points.length; i++) {
        const distance = distanceToSegment(point, points[i - 1], points[i]);
        if (distance < bestDistance) {
          best = edge;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  /* ---------- 力导向模拟 ---------- */
  _step() {
    const nodes = this.nodes;
    for (const edge of this.edges) {
      const source = this._findNode(edge.from);
      const target = this._findNode(edge.to);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = this.springK * (distance - this.springLength);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      if (!source.fixed) { source.vx += fx; source.vy += fy; }
      if (!target.fixed) { target.vx -= fx; target.vy -= fy; }
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const force = this.repulsion / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
        if (!b.fixed) { b.vx += fx; b.vy += fy; }
      }
    }
    const centerX = this.width / 2 / this.scale - this.offsetX;
    const centerY = this.height / 2 / this.scale - this.offsetY;
    for (const node of nodes) {
      if (node.fixed) continue;
      node.vx += (centerX - node.x) * this.centralGravity;
      node.vy += (centerY - node.y) * this.centralGravity;
    }
    let maxSpeed = 0;
    for (const node of nodes) {
      if (node.fixed) continue;
      node.vx *= this.damping;
      node.vy *= this.damping;
      const speed = Math.hypot(node.vx, node.vy);
      if (speed > this.maxVelocity) {
        node.vx = (node.vx / speed) * this.maxVelocity;
        node.vy = (node.vy / speed) * this.maxVelocity;
      }
      node.x += node.vx;
      node.y += node.vy;
      maxSpeed = Math.max(maxSpeed, speed);
    }
    this._draw();
    if (maxSpeed < this.minVelocity && this.nodes.length > 0) {
      this.running = false;
      this.rafId = null;
      return;
    }
    this.rafId = requestAnimationFrame(() => this._step());
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.rafId = requestAnimationFrame(() => this._step());
  }

  resetLayout() {
    this.stop();
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this._resize();
    this._layoutRadial();
    this._draw();
    this.start();
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /* ---------- 渲染 ---------- */
  _edgeStyle(edge) {
    if (this.selectedEdgeId === edge.id) return { color: '#b83d64', alpha: 1, width: 2.8 };
    if (this.hovered && this.hovered.type === 'edge' && this.hovered.value.id === edge.id) return { color: '#c85b7b', alpha: 1, width: 2.4 };
    if (this.selectedNodeId) {
      if (edge.from === this.selectedNodeId) return { color: '#e87b8e', alpha: 1, width: 2.2 };
      if (edge.to === this.selectedNodeId) return { color: '#5c8fc7', alpha: 1, width: 2.2 };
      return { color: '#a9959d', alpha: 0.16, width: 1 };
    }
    return { color: edge.kind === 'ta' ? 'rgba(140,110,120,0.5)' : 'rgba(140,110,120,0.42)', alpha: 1, width: 1.3 };
  }

  _drawArrow(geometry, style) {
    const tip = this._edgePoint(geometry, 0.985);
    const before = this._edgePoint(geometry, 0.94);
    const dx = tip.x - before.x;
    const dy = tip.y - before.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / distance;
    const uy = dy / distance;
    const arrowTip = { x: tip.x - ux * 22, y: tip.y - uy * 22 };
    const base = { x: arrowTip.x - ux * 10, y: arrowTip.y - uy * 10 };
    const px = -uy * 4;
    const py = ux * 4;
    const ctx = this.ctx;
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.moveTo(arrowTip.x, arrowTip.y);
    ctx.lineTo(base.x + px, base.y + py);
    ctx.lineTo(base.x - px, base.y - py);
    ctx.closePath();
    ctx.fill();
  }

  _drawEdgeLabel(edge, geometry, style) {
    if (!edge.label) return;
    const ctx = this.ctx;
    const point = this._edgePoint(geometry, 0.5);
    ctx.font = '11px sans-serif';
    const width = ctx.measureText(edge.label).width + 10;
    ctx.fillStyle = `rgba(255, 250, 252, ${Math.min(0.95, style.alpha + 0.15)})`;
    ctx.fillRect(point.x - width / 2, point.y - 12, width, 18);
    ctx.fillStyle = style.color;
    ctx.textAlign = 'center';
    ctx.fillText(edge.label, point.x, point.y + 1);
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.offsetX, this.offsetY);
    for (const edge of this.edges) {
      const geometry = this._edgeGeometry(edge);
      if (!geometry) continue;
      const style = this._edgeStyle(edge);
      ctx.globalAlpha = style.alpha;
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width;
      ctx.beginPath();
      ctx.moveTo(geometry.source.x, geometry.source.y);
      if (geometry.control) ctx.quadraticCurveTo(geometry.control.x, geometry.control.y, geometry.target.x, geometry.target.y);
      else ctx.lineTo(geometry.target.x, geometry.target.y);
      ctx.stroke();
      if (edge.directed !== false) this._drawArrow(geometry, style);
      this._drawEdgeLabel(edge, geometry, style);
    }
    ctx.globalAlpha = 1;
    for (const node of this.nodes) {
      const isSelected = this.selectedNodeId === node.id;
      const isHovered = this.hovered && this.hovered.type === 'node' && this.hovered.value.id === node.id;
      const isDimmed = this.selectedNodeId && !isSelected && !this.edges.some((edge) =>
        (edge.from === this.selectedNodeId && edge.to === node.id) || (edge.to === this.selectedNodeId && edge.from === node.id));
      const radius = isHovered || isSelected ? 24 : 20;
      ctx.globalAlpha = isDimmed ? 0.28 : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = GROUP_COLORS[node.group] || GROUP_COLORS.其他;
      ctx.fill();
      ctx.lineWidth = isSelected ? 4 : (isHovered ? 3 : 1.5);
      ctx.strokeStyle = isSelected ? '#b83d64' : '#fff';
      ctx.stroke();
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#2c2024';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y + radius + 14);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---------- 交互 ---------- */
  _onPointerDown(e) {
    const point = this._toCanvasPos(e);
    const node = this._hitNode(point);
    if (node) {
      if (node.center) {
        this.lastNodeClick = null;
        this.selectNode(node.id);
        this.canvas.style.cursor = 'default';
        e.preventDefault();
        return;
      }
      this.dragged = node;
      this.dragStart = point;
      this.dragMoved = false;
      node.fixed = true;
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.lastNodeClick = null;
      const edge = this._hitEdge(point);
      if (edge) {
        this.selectEdge(edge.id);
        this.canvas.style.cursor = 'pointer';
      } else {
        this.panning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grab';
      }
    }
    e.preventDefault();
  }

  _onPointerMove(e) {
    const point = this._toCanvasPos(e);
    if (this.dragged) {
      if (Math.hypot(point.x - this.dragStart.x, point.y - this.dragStart.y) > 3) this.dragMoved = true;
      const world = this._screenToWorld(point);
      this.dragged.x = world.x;
      this.dragged.y = world.y;
      this._draw();
      return;
    }
    if (this.panning && this.panStart) {
      this.offsetX += (e.clientX - this.panStart.x) / this.scale;
      this.offsetY += (e.clientY - this.panStart.y) / this.scale;
      this.panStart = { x: e.clientX, y: e.clientY };
      this._draw();
      return;
    }
    const node = this._hitNode(point);
    const edge = node ? null : this._hitEdge(point);
    const next = node ? { type: 'node', value: node } : (edge ? { type: 'edge', value: edge } : null);
    const previous = this.hovered;
    this.hovered = next;
    this.canvas.style.cursor = next ? 'pointer' : 'default';
    if (!next || !previous || next.type !== previous.type || next.value.id !== previous.value.id) {
      this.onNodeHover(next && next.type === 'node' ? next.value.id : null);
      this.onEdgeHover(next && next.type === 'edge' ? next.value : null);
      this._draw();
    }
  }

  _onPointerUp(_event, canceled = false) {
    if (this.dragged) {
      const node = this.dragged;
      if (!this.dragMoved && !canceled) {
        this.selectNode(node.id);
        const now = Date.now();
        const isDoubleClick = this.lastNodeClick
          && this.lastNodeClick.id === node.id
          && now - this.lastNodeClick.time <= this.doubleClickDelay;
        if (isDoubleClick) {
          this.lastNodeClick = null;
          this.onNodeClick(node.id);
        } else {
          this.lastNodeClick = { id: node.id, time: now };
        }
      } else if (this.dragMoved || canceled) {
        this.lastNodeClick = null;
      }
      this.dragged = null;
      this.dragStart = null;
      this.canvas.style.cursor = 'default';
    }
    this.panning = false;
    this.panStart = null;
  }

  _onWheel(e) {
    e.preventDefault();
    const point = this._toCanvasPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(3, Math.max(0.4, this.scale * factor));
    const worldX = point.x / this.scale - this.offsetX;
    const worldY = point.y / this.scale - this.offsetY;
    this.offsetX = point.x / newScale - worldX;
    this.offsetY = point.y / newScale - worldY;
    this.scale = newScale;
    this._draw();
  }

  selectNode(id, notify = true) {
    this.selectedNodeId = id || null;
    this.selectedEdgeId = null;
    this._draw();
    if (notify) this.onNodeSelect(this._findNode(id));
  }

  selectEdge(id, notify = true) {
    this.selectedEdgeId = id || null;
    this.selectedNodeId = null;
    const edge = this.edges.find((item) => item.id === id) || null;
    this._draw();
    if (notify) this.onEdgeSelect(edge);
  }

  clearSelection() {
    this.selectedNodeId = null;
    this.selectedEdgeId = null;
    this._draw();
  }

  destroy() {
    this.stop();
    this.destroyed = true;
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.handlers.pointerdown);
    window.removeEventListener('pointermove', this.handlers.pointermove);
    window.removeEventListener('pointerup', this.handlers.pointerup);
    window.removeEventListener('pointercancel', this.handlers.pointercancel);
    c.removeEventListener('wheel', this.handlers.wheel);
    window.removeEventListener('resize', this.handlers.resize);
  }
}
