/** Parameters for {@link wrapSvgInInteractiveHtml}. */
export interface WrapSvgInInteractiveHtmlParams {
    /**
     * The rendered SVG markup to embed. Dimensions are read from the SVG's own
     * width/height attributes at runtime, so they need not be passed separately.
     */
    svg: string;
}

const VIEWER_SCRIPT = `
(function () {
  var stage = document.getElementById('sfn-stage');
  var content = document.getElementById('sfn-content');
  var label = document.getElementById('sfn-zoom-label');
  var scale = 1, tx = 0, ty = 0, dragging = false, lastX = 0, lastY = 0;
  function apply() {
    content.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    label.textContent = Math.round(scale * 100) + '%';
  }
  function fit() {
    var svg = content.firstElementChild;
    var w = svg.getAttribute('width') ? parseFloat(svg.getAttribute('width')) : content.offsetWidth;
    var h = svg.getAttribute('height') ? parseFloat(svg.getAttribute('height')) : content.offsetHeight;
    var s = Math.min(stage.clientWidth / w, stage.clientHeight / h);
    scale = isFinite(s) && s > 0 ? s : 1;
    tx = (stage.clientWidth - w * scale) / 2;
    ty = (stage.clientHeight - h * scale) / 2;
    apply();
  }
  stage.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = stage.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    var next = Math.min(8, Math.max(0.05, scale * factor));
    tx = mx - (mx - tx) * (next / scale);
    ty = my - (my - ty) * (next / scale);
    scale = next; apply();
  }, { passive: false });
  stage.addEventListener('pointerdown', function (e) { dragging = true; lastX = e.clientX; lastY = e.clientY; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', function (e) { if (!dragging) return; tx += e.clientX - lastX; ty += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; apply(); });
  stage.addEventListener('pointerup', function (e) { if (!dragging) return; dragging = false; stage.releasePointerCapture(e.pointerId); });
  document.querySelector('[data-sfn-zoom="in"]').addEventListener('click', function () { scale = Math.min(8, scale * 1.2); apply(); });
  document.querySelector('[data-sfn-zoom="out"]').addEventListener('click', function () { scale = Math.max(0.05, scale / 1.2); apply(); });
  document.querySelector('[data-sfn-zoom="fit"]').addEventListener('click', fit);
  document.querySelector('[data-sfn-zoom="reset"]').addEventListener('click', function () { scale = 1; tx = 0; ty = 0; apply(); });
  fit();
})();
`;

/**
 * Wrap rendered SVG in a self-contained HTML document with an inline pan/zoom
 * viewer (drag to pan, wheel to zoom, fit/reset toolbar). No external references,
 * so it works offline and from file://.
 */
export function wrapSvgInInteractiveHtml(params: WrapSvgInInteractiveHtmlParams): string {
    const { svg } = params;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sfn-diagram</title>
<style>
  html, body { margin: 0; height: 100%; font-family: system-ui, sans-serif; }
  #sfn-stage { position: absolute; inset: 0; overflow: hidden; background: #fafafa; cursor: grab; }
  #sfn-stage:active { cursor: grabbing; }
  #sfn-content { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
  #sfn-toolbar { position: absolute; top: 12px; left: 12px; z-index: 1; display: flex; gap: 4px; align-items: center;
    background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 4px 8px; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
  #sfn-toolbar button { border: 0; background: #f2f2f2; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 14px; }
  #sfn-toolbar button:hover { background: #e6e6e6; }
  #sfn-zoom-label { min-width: 44px; text-align: center; font-size: 12px; color: #555; }
</style>
</head>
<body>
<div id="sfn-toolbar">
  <button data-sfn-zoom="out" title="Zoom out">-</button>
  <span id="sfn-zoom-label">100%</span>
  <button data-sfn-zoom="in" title="Zoom in">+</button>
  <button data-sfn-zoom="fit" title="Zoom to fit">Fit</button>
  <button data-sfn-zoom="reset" title="Reset">Reset</button>
</div>
<div id="sfn-stage"><div id="sfn-content">${svg}</div></div>
<script>${VIEWER_SCRIPT}</script>
</body>
</html>`;
}
