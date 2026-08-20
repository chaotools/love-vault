// 自研力导向关系图（零依赖，借鉴 vis-network 物理模型的方法，不引用第三方库）
// 力：边=弹簧力（互相靠近）、节点间=斥力（互相推开）、朝中心=引力（整体聚拢）
// 阻尼+速度限制→迭代收敛；拖拽固定节点；滚轮缩放、空白平移；Canvas 渲染
//
// 用法：
//   const g = new RelationGraph(canvasEl, {
//     nodes: [{id, label, group, x, y, fixed}],
//     edges: [{from, to, label}],
//     onNodeClick(id), onNodeHover(id)
//   });
//   g.setData(nodes, edges); g.start(); g.destroy();

const GROUP_COLORS = {
  家人: '#e8a06a',
  朋友: '#6abf8a',
  同事: '#6ea8dc',
  其他: '#b08ad6',
  TA: '#e87b8e'
};

export class RelationGraph {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onNodeClick = opts.onNodeClick || (() => {});
    this.onNodeHover = opts.onNodeHover || (() => {});
    this.nodes = [];
    this.edges = [];
    this.running = false;
    this.rafId = null;
    this.dragged = null;
    this.hovered = null;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.panning = false;
    this.panStart = null;
    this.width = 0;
    this.height = 0;
    this.destroyed = false;

    // 物理参数（借鉴 vis-network 的 spring/repulsion/damping 思路）
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
      mousedown: (e) => this._onMouseDown(e),
      mousemove: (e) => this._onMouseMove(e),
      mouseup: () => this._onMouseUp(),
      wheel: (e) => this._onWheel(e),
      dblclick: (e) => this._onDblClick(e),
      resize: () => {
        if (this.destroyed) return;
        this._resize();
        this._centerNodes();
        this._draw();
      }
    };
    c.addEventListener('mousedown', this.handlers.mousedown);
    window.addEventListener('mousemove', this.handlers.mousemove);
    window.addEventListener('mouseup', this.handlers.mouseup);
    c.addEventListener('wheel', this.handlers.wheel, { passive: false });
    c.addEventListener('dblclick', this.handlers.dblclick);
    window.addEventListener('resize', this.handlers.resize);
  }

  setData(nodes, edges) {
    this.nodes = nodes;
    this.edges = edges;
    this._resize();
    this._centerNodes();
    // 给没有位置的节点随机初始位置（以中心为圆心散开）
    const cx = this.width / 2, cy = this.height / 2;
    this.nodes.forEach((n, i) => {
      if (n.x === undefined || n.y === undefined) {
        const angle = (i / Math.max(1, this.nodes.length)) * Math.PI * 2;
        const r = 60 + (i % 5) * 30;
        n.x = cx + Math.cos(angle) * r;
        n.y = cy + Math.sin(angle) * r;
      }
      n.vx = n.vx || 0;
      n.vy = n.vy || 0;
    });
    this.start();
  }

  _resize() {
    // 物理像素只用于画布清晰度；物理模型、鼠标命中和绘制均使用 CSS 逻辑像素。
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
  _worldToScreen(n) {
    return { x: (n.x + this.offsetX) * this.scale, y: (n.y + this.offsetY) * this.scale };
  }
  _screenToWorld(p) {
    return { x: p.x / this.scale - this.offsetX, y: p.y / this.scale - this.offsetY };
  }
  _hitNode(p) {
    // 从上层往下找（后画的在上面）
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const s = this._worldToScreen(this.nodes[i]);
      const r = 22 * this.scale;
      if (Math.hypot(p.x - s.x, p.y - s.y) <= r) return this.nodes[i];
    }
    return null;
  }

  /* ---------- 力导向模拟 ---------- */
  _step() {
    const nodes = this.nodes;
    // 弹簧力（边）与斥力（所有节点对）
    for (const e of this.edges) {
      const a = nodes.find((n) => n.id === e.from);
      const b = nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const force = this.springK * (dist - this.springLength);
      const fx = (dx / dist) * force, fy = (dy / dist) * force;
      if (!a.fixed) { a.vx += fx; a.vy += fy; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = this.repulsion / (dist * dist);
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        if (!a.fixed) { a.vx -= fx; a.vy -= fy; }
        if (!b.fixed) { b.vx += fx; b.vy += fy; }
      }
    }
    // 中心引力
    const cx = this.width / 2 / this.scale - this.offsetX;
    const cy = this.height / 2 / this.scale - this.offsetY;
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx += (cx - n.x) * this.centralGravity;
      n.vy += (cy - n.y) * this.centralGravity;
    }
    // 阻尼 + 速度限制 + 位移
    let maxSpeed = 0;
    for (const n of nodes) {
      if (n.fixed) continue;
      n.vx *= this.damping; n.vy *= this.damping;
      const speed = Math.hypot(n.vx, n.vy);
      if (speed > this.maxVelocity) { n.vx = (n.vx / speed) * this.maxVelocity; n.vy = (n.vy / speed) * this.maxVelocity; }
      n.x += n.vx; n.y += n.vy;
      maxSpeed = Math.max(maxSpeed, speed);
    }
    this._draw();
    // 收敛判断
    if (maxSpeed < this.minVelocity && this.nodes.length > 0) {
      this.running = false;
      return;
    }
    this.rafId = requestAnimationFrame(() => this._step());
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.rafId = requestAnimationFrame(() => this._step());
  }
  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  /* ---------- 渲染 ---------- */
  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.scale(this.scale, this.scale);
    ctx.translate(this.offsetX, this.offsetY);

    // 边
    for (const e of this.edges) {
      const a = this.nodes.find((n) => n.id === e.from);
      const b = this.nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      ctx.strokeStyle = 'rgba(140,110,120,0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      // 边标签（关系类型）在中间
      if (e.label) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#8a7a80';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, mx, my - 4);
      }
    }

    // 节点
    for (const n of this.nodes) {
      const color = GROUP_COLORS[n.group] || GROUP_COLORS.其他;
      const isHover = this.hovered && this.hovered.id === n.id;
      const r = isHover ? 24 : 20;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = isHover ? 3 : 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      // 标签
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#2c2024';
      ctx.textAlign = 'center';
      ctx.fillText(n.label, n.x, n.y + r + 14);
    }
    ctx.restore();
  }

  /* ---------- 交互 ---------- */
  _onMouseDown(e) {
    const p = this._toCanvasPos(e);
    const hit = this._hitNode(p);
    if (hit) {
      this.dragged = hit;
      hit.fixed = true; // 拖拽即固定
      this.canvas.style.cursor = 'grabbing';
    } else {
      this.panning = true;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.canvas.style.cursor = 'grab';
    }
    e.preventDefault();
  }
  _onMouseMove(e) {
    const p = this._toCanvasPos(e);
    if (this.dragged) {
      const w = this._screenToWorld(p);
      this.dragged.x = w.x;
      this.dragged.y = w.y;
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
    // 悬停
    const hit = this._hitNode(p);
    if (hit && (!this.hovered || this.hovered.id !== hit.id)) {
      this.hovered = hit;
      this.canvas.style.cursor = 'pointer';
      this.onNodeHover(hit.id);
      this._draw();
    } else if (!hit && this.hovered) {
      this.hovered = null;
      this.canvas.style.cursor = 'default';
      this._draw();
    }
  }
  _onMouseUp() {
    if (this.dragged) {
      this.dragged = null;
      this.canvas.style.cursor = 'default';
    }
    this.panning = false;
    this.panStart = null;
  }
  _onWheel(e) {
    e.preventDefault();
    const p = this._toCanvasPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.min(3, Math.max(0.4, this.scale * factor));
    // 以鼠标为中心缩放
    const wx = p.x / this.scale - this.offsetX;
    const wy = p.y / this.scale - this.offsetY;
    this.offsetX = p.x / newScale - wx;
    this.offsetY = p.y / newScale - wy;
    this.scale = newScale;
    this._draw();
  }
  _onDblClick(e) {
    const p = this._toCanvasPos(e);
    const hit = this._hitNode(p);
    if (hit) this.onNodeClick(hit.id);
  }

  destroy() {
    this.stop();
    this.destroyed = true;
    const c = this.canvas;
    c.removeEventListener('mousedown', this.handlers.mousedown);
    window.removeEventListener('mousemove', this.handlers.mousemove);
    window.removeEventListener('mouseup', this.handlers.mouseup);
    c.removeEventListener('wheel', this.handlers.wheel);
    c.removeEventListener('dblclick', this.handlers.dblclick);
    window.removeEventListener('resize', this.handlers.resize);
  }
}
