/* Reusable ordered sidebar panes. Layout calculation has no DOM dependencies. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VulSidebar = api;
})(globalThis, function () {
  'use strict';
  const HEADER = 36, DIVIDER = 10, MIN_CONTENT = 24;
  const positive = value => Number.isFinite(value) && value > 0;
  function defaultWeights(sections) {
    const open = sections.filter(section => section.open);
    const reserved = open.reduce((sum, section) => sum + (positive(section.defaultShare) ? section.defaultShare : 0), 0);
    const flexible = open.filter(section => !positive(section.defaultShare)).length;
    return Object.fromEntries(open.map(section => [section.id, positive(section.defaultShare)
      ? section.defaultShare : reserved < 1 && flexible ? (1 - reserved) / flexible : 1]));
  }
  function calculateLayout(sections, height, weights = {}) {
    const open = sections.map((section, index) => ({ ...section, index })).filter(section => section.open);
    const dividers = open.slice(0, -1).map((upper, index) => ({ upper: upper.id, lower: open[index + 1].id, after: upper.index }));
    const fixed = sections.length * HEADER + dividers.length * DIVIDER;
    const available = Math.max(open.length * MIN_CONTENT, (Number.isFinite(height) ? height : 0) - fixed);
    const content = Object.fromEntries(sections.map(section => [section.id, 0]));
    let pending = open.slice(), remaining = available;
    // Initial content fitting is a default only. Any restored/manual weights
    // take precedence, including sizes larger than the initial share cap.
    if (!Object.values(weights).some(positive) && open.length > 1) {
      for (const section of open) {
        if (!positive(section.initialHeight) || pending.length <= 1) continue;
        const fitted = Math.max(MIN_CONTENT, Math.min(section.initialHeight - HEADER,
          remaining - (pending.length - 1) * MIN_CONTENT));
        content[section.id] = fitted; remaining -= fitted;
        pending = pending.filter(item => item.id !== section.id);
      }
    }
    const defaults = defaultWeights(pending);
    // Distribute actual content heights, honoring minima without distorting the
    // requested weights when all panes have enough room.
    while (pending.length) {
      const weight = section => positive(weights[section.id]) ? weights[section.id] : defaults[section.id];
      const sum = pending.reduce((total, section) => total + weight(section), 0);
      const small = pending.filter(section => remaining * weight(section) / sum < MIN_CONTENT);
      if (!small.length) {
        for (const section of pending) content[section.id] = remaining * weight(section) / sum;
        break;
      }
      for (const section of small) { content[section.id] = MIN_CONTENT; remaining -= MIN_CONTENT; }
      pending = pending.filter(section => !small.includes(section));
    }
    return { content, dividers, heights: sections.map(section => HEADER + content[section.id]),
      totalHeight: fixed + open.reduce((total, section) => total + content[section.id], 0) };
  }
  function migrateState(saved = {}, expansion = {}, ratio) {
    if (!saved || typeof saved !== 'object') saved = {};
    const expanded = {}, weights = {};
    for (const key of ['globals', 'module']) if (typeof expansion[key] === 'boolean') expanded[key] = expansion[key];
    if (Number.isFinite(ratio) && Math.abs(ratio - 0.3) > 0.0001) {
      const share = Math.max(0.1, Math.min(0.9, ratio));
      weights.globals = share; weights.module = 1 - share;
    }
    for (const [key, value] of Object.entries(saved.expanded || {})) if (typeof value === 'boolean') expanded[key] = value;
    for (const [key, value] of Object.entries(saved.weights || {})) if (positive(value)) weights[key] = value;
    return { version: 1, expanded, weights };
  }
  class Sidebar {
    constructor(container, options = {}) {
      this.container = container;
      this.document = container.ownerDocument;
      this.window = this.document.defaultView;
      this.state = migrateState(options.state, options.expansion, options.ratio);
      this.onChange = options.onChange || (() => {});
      this.items = []; this.dividers = new Map(); this.drag = undefined;
      this.disposed = false; this.nextId = 0;
    }
    serializeState() { return { version: 1, expanded: { ...this.state.expanded }, weights: { ...this.state.weights } }; }
    setSections(descriptions) {
      if (this.disposed) return;
      this.finishDrag(); this.dividers.clear();
      this.container.replaceChildren();
      this.items = descriptions.map(description => {
        const node = this.document.createElement('details');
        node.className = `sidebar-section ${description.className || ''}`;
        node.dataset.section = description.id;
        node.id = `vul-sidebar-${++this.nextId}`;
        node.open = this.state.expanded[description.id] ?? description.defaultOpen ?? true;
        const heading = this.document.createElement('summary');
        heading.textContent = description.title;
        if (description.componentId) heading.dataset.id = description.componentId;
        if (description.onSelect) heading.addEventListener('click', () => description.onSelect());
        node.append(heading);
        const body = this.document.createElement('div'); body.className = 'declarations'; node.append(body);
        const item = { ...description, node, heading, body };
        node.addEventListener('toggle', () => {
          if (!node.isConnected || !this.items.includes(item)) return;
          this.state.expanded[item.id] = node.open;
          this.finishDrag(); this.resize(); this.onChange();
        });
        this.container.append(node);
        description.render(body);
        return item;
      });
      this.resize();
    }
    sections() { return this.items.map(item => ({ id: item.id, open: item.node.open, defaultShare: item.defaultShare })); }
    measureInitialHeight(item, height) {
      if (!item.node.open || !item.initialFit || !positive(height)) return undefined;
      // scrollHeight on an already stretched body includes its unused space.
      // Measure at natural height, then restore the scrollable viewport style.
      const previous = item.body.style.getPropertyValue('height');
      const priority = item.body.style.getPropertyPriority('height');
      let natural;
      try {
        item.body.style.setProperty('height', 'auto');
        natural = Math.ceil(Math.max(item.body.scrollHeight, item.body.getBoundingClientRect().height));
      } finally {
        if (previous) item.body.style.setProperty('height', previous, priority);
        else item.body.style.removeProperty('height');
      }
      if (!positive(natural)) return undefined;
      const cap = positive(item.initialFit.maxShare) ? height * item.initialFit.maxShare : height;
      return Math.min(HEADER + natural, cap);
    }
    resize() {
      if (this.disposed) return;
      const height = this.container.clientHeight || this.container.getBoundingClientRect().height;
      const sections = this.sections();
      if (!Object.values(this.state.weights).some(positive)) {
        for (let i = 0; i < sections.length; i++) sections[i].initialHeight = this.measureInitialHeight(this.items[i], height);
      }
      this.layout = calculateLayout(sections, height, this.state.weights);
      const rows = [], children = [], active = new Set();
      this.items.forEach((item, index) => {
        // Definite content heights avoid percentage resolution through the
        // browser's anonymous <details> content wrapper. Each body owns its scroll.
        item.body.style.height = `${this.layout.content[item.id]}px`;
        rows.push(`${this.layout.heights[index]}px`); children.push(item.node);
        const edge = this.layout.dividers.find(divider => divider.after === index);
        if (edge) {
          const key = JSON.stringify([edge.upper, edge.lower]); active.add(key);
          let divider = this.dividers.get(key);
          if (!divider) { divider = this.makeDivider(edge); this.dividers.set(key, divider); }
          this.updateDivider(divider, edge);
          rows.push(`${DIVIDER}px`); children.push(divider);
        }
      });
      for (const [key, divider] of this.dividers) if (!active.has(key)) { divider.remove(); this.dividers.delete(key); }
      const previous = [...this.container.children];
      if (previous.length !== children.length || previous.some((child, index) => child !== children[index])) {
        this.finishDrag(); this.container.replaceChildren(...children);
      }
      this.container.style.gridTemplateRows = rows.join(' ') || 'none';
      this.container.classList.toggle('split-navigation', this.layout.dividers.length > 0);
    }
    pair(edge) {
      const upper = this.layout.content[edge.upper], lower = this.layout.content[edge.lower];
      return { upper, total: upper + lower };
    }
    adjust(edge, upper) {
      const { total } = this.pair(edge);
      const next = Math.max(MIN_CONTENT, Math.min(total - MIN_CONTENT, upper));
      const values = { ...this.layout.content, [edge.upper]: next, [edge.lower]: total - next };
      const sum = Object.values(values).reduce((a, b) => a + b, 0);
      for (const item of this.items) if (item.node.open) this.state.weights[item.id] = values[item.id] / sum;
      this.resize();
    }
    resetPair(edge) {
      const defaults = defaultWeights(this.sections());
      const { total } = this.pair(edge);
      this.adjust(edge, total * defaults[edge.upper] / (defaults[edge.upper] + defaults[edge.lower]));
      this.onChange();
    }
    updateDivider(node, edge) {
      const upper = this.items.find(item => item.id === edge.upper), lower = this.items.find(item => item.id === edge.lower);
      const pair = this.pair(edge), percent = Math.round(pair.upper / pair.total * 100);
      node.setAttribute('aria-label', `Resize ${upper.title} and ${lower.title}`);
      node.setAttribute('aria-controls', `${upper.node.id} ${lower.node.id}`);
      node.setAttribute('aria-valuemin', String(Math.ceil(MIN_CONTENT / pair.total * 100)));
      node.setAttribute('aria-valuemax', String(Math.floor((1 - MIN_CONTENT / pair.total) * 100)));
      node.setAttribute('aria-valuenow', String(percent));
      node.setAttribute('aria-valuetext', `${upper.title} ${percent}%, ${lower.title} ${100 - percent}%`);
    }
    makeDivider(edge) {
      const divider = this.document.createElement('div'); divider.className = 'sidebar-divider';
      divider.dataset.upper = edge.upper; divider.dataset.lower = edge.lower;
      divider.tabIndex = 0; divider.setAttribute('role', 'separator'); divider.setAttribute('aria-orientation', 'horizontal');
      divider.title = 'Drag to resize · Arrow keys to adjust · Double-click to reset';
      divider.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        event.preventDefault(); this.finishDrag();
        this.drag = { divider, edge, pointer: event.pointerId, startY: event.clientY, upper: this.pair(edge).upper };
        divider.focus(); divider.setPointerCapture(event.pointerId);
        this.document.body.classList.add('resizing-sidebar');
        this.blur = () => this.finishDrag(); this.window.addEventListener('blur', this.blur);
      });
      divider.addEventListener('pointermove', event => {
        if (this.drag?.divider === divider && this.drag.pointer === event.pointerId) this.adjust(edge, this.drag.upper + event.clientY - this.drag.startY);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) divider.addEventListener(type, event => {
        if (this.drag?.divider === divider && this.drag.pointer === event.pointerId) this.finishDrag();
      });
      divider.addEventListener('keydown', event => {
        const { upper, total } = this.pair(edge);
        const next = { ArrowUp: upper - total * 0.02, ArrowDown: upper + total * 0.02,
          PageUp: upper - total * 0.1, PageDown: upper + total * 0.1, Home: MIN_CONTENT, End: total - MIN_CONTENT }[event.key];
        if (next === undefined) return;
        event.preventDefault(); this.adjust(edge, next); this.onChange();
      });
      divider.addEventListener('dblclick', () => this.resetPair(edge));
      return divider;
    }
    finishDrag() {
      const drag = this.drag; if (!drag) return;
      this.drag = undefined;
      if (drag.divider.hasPointerCapture(drag.pointer)) drag.divider.releasePointerCapture(drag.pointer);
      this.document.body.classList.remove('resizing-sidebar');
      this.window.removeEventListener('blur', this.blur); this.onChange();
    }
    dispose() {
      this.finishDrag(); this.disposed = true;
      this.items = []; this.dividers.clear(); this.container.replaceChildren();
    }
  }
  return { Sidebar, calculateLayout, defaultWeights, migrateState, HEADER, DIVIDER, MIN_CONTENT };
});
