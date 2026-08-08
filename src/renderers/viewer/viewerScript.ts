/** Parameters for {@link buildViewerScript}. */
export interface BuildViewerScriptParams {
    /** Whether the detail panel is wired up (only when state data was embedded). */
    hasStateData: boolean;
}

/**
 * Shared helpers: the transform application, and the translate() reader used to
 * centre on a node without `getBBox()` (unreliable under the stage's CSS transform).
 */
const CORE_SCRIPT = `
  var stage = document.getElementById('sfn-stage');
  var content = document.getElementById('sfn-content');
  var label = document.getElementById('sfn-zoom-label');
  var scale = 1, tx = 0, ty = 0;
  var MIN_SCALE = 0.05, MAX_SCALE = 8;

  function apply() {
    content.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    label.textContent = Math.round(scale * 100) + '%';
  }

  function svgSize() {
    var svg = content.firstElementChild;
    return {
      width: svg.getAttribute('width') ? parseFloat(svg.getAttribute('width')) : content.offsetWidth,
      height: svg.getAttribute('height') ? parseFloat(svg.getAttribute('height')) : content.offsetHeight
    };
  }

  function fit() {
    var size = svgSize();
    var next = Math.min(stage.clientWidth / size.width, stage.clientHeight / size.height);
    scale = isFinite(next) && next > 0 ? next : 1;
    tx = (stage.clientWidth - size.width * scale) / 2;
    ty = (stage.clientHeight - size.height * scale) / 2;
    apply();
  }

  // Read the group's own translate() rather than measuring it: getBBox() reports
  // pre-transform geometry and the stage applies its own CSS transform on top.
  function nodeCenter(group) {
    var transform = group.getAttribute('transform') || '';
    var match = transform.match(/translate\\(\\s*(-?[\\d.]+)[ ,]+(-?[\\d.]+)/);
    if (!match) return null;
    var svg = content.firstElementChild;
    var viewBox = (svg.getAttribute('viewBox') || '0 0 0 0').split(/[ ,]+/).map(parseFloat);
    // Node coordinates are in viewBox space; shift by its origin to get content-box pixels.
    return { x: parseFloat(match[1]) - viewBox[0], y: parseFloat(match[2]) - viewBox[1] };
  }

  function centerOn(group) {
    var center = nodeCenter(group);
    if (!center) return;
    tx = stage.clientWidth / 2 - center.x * scale;
    ty = stage.clientHeight / 2 - center.y * scale;
    apply();
  }
`;

const PAN_ZOOM_SCRIPT = `
  var dragging = false, lastX = 0, lastY = 0, travel = 0, downTarget = null;
  var CLICK_SLOP = 4;

  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = stage.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    var next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    tx = mx - (mx - tx) * (next / scale);
    ty = my - (my - ty) * (next / scale);
    scale = next; apply();
  }, { passive: false });

  stage.addEventListener('pointerdown', function (e) {
    dragging = true; travel = 0; lastX = e.clientX; lastY = e.clientY;
    // Remember what was pressed: setPointerCapture retargets every later pointer
    // event to the stage, so by pointerup e.target is no longer the node.
    downTarget = e.target;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    travel += Math.abs(dx) + Math.abs(dy);
    // Only start panning once the pointer has clearly moved, so a click that
    // jitters by a pixel still opens the detail panel.
    if (travel > CLICK_SLOP) { stage.classList.add('sfn-dragging'); tx += dx; ty += dy; apply(); }
    lastX = e.clientX; lastY = e.clientY;
  });
  stage.addEventListener('pointerup', function (e) {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('sfn-dragging');
    stage.releasePointerCapture(e.pointerId);
    if (travel <= CLICK_SLOP) handleStageClick(downTarget);
    downTarget = null;
  });

  document.querySelector('[data-sfn-zoom="in"]').addEventListener('click', function () {
    scale = Math.min(MAX_SCALE, scale * 1.2); apply();
  });
  document.querySelector('[data-sfn-zoom="out"]').addEventListener('click', function () {
    scale = Math.max(MIN_SCALE, scale / 1.2); apply();
  });
  document.querySelector('[data-sfn-zoom="fit"]').addEventListener('click', fit);
  document.querySelector('[data-sfn-zoom="reset"]').addEventListener('click', function () {
    scale = 1; tx = 0; ty = 0; apply();
  });
`;

const SEARCH_SCRIPT = `
  var searchInput = document.getElementById('sfn-search');
  var searchCount = document.getElementById('sfn-search-count');
  var searchables = Array.prototype.slice.call(content.querySelectorAll('[data-state-id]'));
  var hits = [], hitIndex = 0;

  function clearSearch() {
    searchables.forEach(function (group) {
      group.classList.remove('sfn-dim');
      group.classList.remove('sfn-hit');
    });
    hits = []; hitIndex = 0;
    searchCount.textContent = '';
  }

  function runSearch() {
    var query = searchInput.value.trim().toLowerCase();
    if (!query) { clearSearch(); return; }
    hits = [];
    searchables.forEach(function (group) {
      var id = (group.getAttribute('data-state-id') || '').toLowerCase();
      var matched = id.indexOf(query) !== -1;
      group.classList.toggle('sfn-dim', !matched);
      group.classList.remove('sfn-hit');
      if (matched) hits.push(group);
    });
    hitIndex = 0;
    updateHit(false);
  }

  function updateHit(shouldCenter) {
    searchables.forEach(function (group) { group.classList.remove('sfn-hit'); });
    if (!hits.length) { searchCount.textContent = '0 / 0'; return; }
    if (hitIndex >= hits.length) hitIndex = 0;
    if (hitIndex < 0) hitIndex = hits.length - 1;
    var current = hits[hitIndex];
    current.classList.add('sfn-hit');
    searchCount.textContent = (hitIndex + 1) + ' / ' + hits.length;
    if (shouldCenter) centerOn(current);
  }

  searchInput.addEventListener('input', function () { runSearch(); if (hits.length) centerOn(hits[0]); });
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); hitIndex += e.shiftKey ? -1 : 1; updateHit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); searchInput.value = ''; clearSearch(); searchInput.blur(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== searchInput) { e.preventDefault(); searchInput.focus(); }
  });
`;

const DETAIL_SCRIPT = `
  var panel = document.getElementById('sfn-panel');
  var panelTitle = document.getElementById('sfn-panel-title');
  var panelBody = document.getElementById('sfn-panel-body');
  var stateData = {};
  try {
    stateData = JSON.parse(document.getElementById('sfn-state-data').textContent) || {};
  } catch (err) {
    stateData = {};
  }

  var SUMMARY_FIELDS = ['Type', 'Resource', 'Next', 'Retry', 'Catch', 'Assign'];

  function summarize(value) {
    if (Array.isArray(value)) return value.length + ' entr' + (value.length === 1 ? 'y' : 'ies');
    if (value && typeof value === 'object') return Object.keys(value).join(', ');
    return String(value);
  }

  function closePanel() {
    panel.classList.remove('sfn-open');
  }

  function openPanel(stateId) {
    var state = stateData[stateId];
    if (!state) return;
    panelTitle.textContent = stateId;

    var list = document.createElement('dl');
    SUMMARY_FIELDS.forEach(function (field) {
      if (state[field] === undefined) return;
      var row = document.createElement('div');
      row.className = 'sfn-field';
      var term = document.createElement('dt');
      term.textContent = field;
      var detail = document.createElement('dd');
      // textContent throughout: state content is untrusted and must never be parsed as HTML.
      detail.textContent = summarize(state[field]);
      row.appendChild(term); row.appendChild(detail);
      list.appendChild(row);
    });

    var pre = document.createElement('pre');
    pre.id = 'sfn-panel-json';
    pre.textContent = JSON.stringify(state, null, 2);

    panelBody.textContent = '';
    panelBody.appendChild(list);
    panelBody.appendChild(pre);
    panel.classList.add('sfn-open');
  }

  document.getElementById('sfn-panel-close').addEventListener('click', closePanel);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePanel();
  });
`;

/**
 * Stage-click dispatch when the detail panel is present. Takes the element that
 * was pressed, since pointer capture rewrites the target before pointerup.
 */
const STAGE_CLICK_WITH_PANEL = `
  function handleStageClick(target) {
    var group = target && target.closest ? target.closest('[data-state-id]') : null;
    if (group) openPanel(group.getAttribute('data-state-id'));
    else closePanel();
  }
`;

/** No-op stage-click dispatch when no state data was embedded. */
const STAGE_CLICK_WITHOUT_PANEL = `
  function handleStageClick() {}
`;

/**
 * Build the viewer's inline controller script.
 *
 * Composes pan/zoom, search, and (when state data is embedded) the click-a-state
 * detail panel into a single IIFE with no external references, so the document
 * stays self-contained and works from `file://`.
 *
 * @param params - Script parameters
 * @param params.hasStateData - Whether to wire up the detail panel
 * @returns JavaScript source for inlining into a `<script>` element
 *
 * @example
 * ```typescript
 * const script = buildViewerScript({ hasStateData: true });
 * const body = `<script>${script}</script>`;
 * ```
 */
export function buildViewerScript(params: BuildViewerScriptParams): string {
    const { hasStateData } = params;

    return `
(function () {
${CORE_SCRIPT}
${hasStateData ? DETAIL_SCRIPT : ''}
${hasStateData ? STAGE_CLICK_WITH_PANEL : STAGE_CLICK_WITHOUT_PANEL}
${PAN_ZOOM_SCRIPT}
${SEARCH_SCRIPT}
  fit();
})();
`;
}
