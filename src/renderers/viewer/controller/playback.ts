import { hook, type ListenerRegistry } from './dom';
import type { Viewport } from './viewport';
import type { ExecutionTimeline, TimelineEntry } from '../../../types';

/**
 * Execution playback: replays the embedded timeline over the diagram, painting each
 * state with the status it held at the playhead rather than the outcome it ended with.
 *
 * Present only when a timeline was embedded (`generateHtml({ history })`). Everything
 * here is additive and reversible — playback adds classes and never touches the inline
 * `fill` / `stroke` the static overlay baked in, so stopping restores exactly the
 * document that was served.
 */

/** Class applied to every state and edge while playback owns the diagram's colours. */
const PLAYING_CLASS = 'sfn-playing';

/** Status classes, in the order a paint may need to remove them. */
const STATUS_CLASSES = [
    'sfn-exec-active',
    'sfn-exec-caught',
    'sfn-exec-failed',
    'sfn-exec-pending',
    'sfn-exec-succeeded',
];

/** Everything a replay may have painted, for the sweep that undoes all of it. */
const PAINTED_SELECTOR = STATUS_CLASSES.map((name) => '.' + name)
    .concat('.sfn-exec-taken', '.sfn-exec-untaken')
    .join(', ');

/**
 * Display duration bounds, in milliseconds, for one interval of the run.
 *
 * Real durations span microseconds to hours, so they are compressed rather than
 * scaled: a 40ms Task still has to register, and a five-minute `Wait` must not stall
 * the replay for five minutes. Every interval lands between these two.
 */
const MIN_STEP_MS = 70;
const MAX_STEP_MS = 900;

/** Real duration, in ms, that maps to roughly the middle of the compressed range. */
const COMPRESSION_REFERENCE_MS = 250;

/** Real duration, in ms, at and above which an interval gets the full {@link MAX_STEP_MS}. */
const COMPRESSION_CEILING_MS = 60_000;

/** Total display duration, in ms, a proportional (real-ratio) replay is scaled to. */
const PROPORTIONAL_TOTAL_MS = 8_000;

/** Slack, in real ms, that a step must clear to count as leaving the current instant. */
const STEP_EPSILON_MS = 0.001;

/** Parameters for {@link createPlayback}. */
export interface CreatePlaybackParams {
    /** The `data-sfn="content"` node holding the rendered view(s). */
    content: HTMLElement;
    /** The document animation frames and timers are scheduled against; null when detached. */
    ownerDoc: Document | null;
    /** Listener registry for every handler this module attaches. */
    registry: ListenerRegistry;
    /** Scope for hook lookups. */
    root: ParentNode;
    /** The `data-sfn="stage"` node, watched for the manual pan that suspends auto-pan. */
    stage: HTMLElement;
    /** The execution timeline to replay. Omit to leave the controls absent and inert. */
    timeline?: ExecutionTimeline;
    /** Transform state, for keeping the active state in view. */
    viewport: Viewport;
}

/** Playback's controls, all no-ops when no timeline was embedded. */
export interface Playback {
    /** Whether a timeline was embedded and the controls are live. */
    enabled: boolean;
    /** Handle a playback keyboard shortcut; returns whether it was one. */
    handleKey(key: string): boolean;
    /**
     * Stop and take the controls away for good: the diagram they replayed is gone.
     * A host that swaps in freshly-rendered content is showing a different definition,
     * which this timeline no longer describes.
     */
    retire(): void;
    /** Stop, drop every playback class, and leave the static overlay showing. */
    stop(): void;
}

/** A real instant mapped onto its position in compressed display time. */
interface TimeScale {
    /** Display position, in ms, of a real instant. */
    displayAt(realMs: number): number;
    /** Total display duration of the run. */
    displayTotal: number;
    /** The real instant a display position lands on. */
    realAt(displayMs: number): number;
}

/**
 * Compress one real interval into a display duration: log-scaled between
 * {@link MIN_STEP_MS} and {@link MAX_STEP_MS}, so ordering and rough magnitude survive
 * while the extremes stop dominating the replay.
 */
function compressInterval(realMs: number): number {
    if (realMs <= 0) return 0;
    const ratio =
        Math.log1p(realMs / COMPRESSION_REFERENCE_MS) /
        Math.log1p(COMPRESSION_CEILING_MS / COMPRESSION_REFERENCE_MS);
    return MIN_STEP_MS + (MAX_STEP_MS - MIN_STEP_MS) * Math.min(1, ratio);
}

/**
 * Build the real-time to display-time mapping.
 *
 * Every instant an entry begins or ends becomes a knot, and each interval between two
 * knots gets its own display duration. Mapping intervals rather than entries is what
 * keeps overlapping runs — concurrent Map iterations, Parallel branches — consistent
 * with each other: they share the knots that fall inside them.
 */
function buildTimeScale(timeline: ExecutionTimeline, proportional: boolean): TimeScale {
    const knots: number[] = [timeline.startMs, timeline.endMs];
    for (const entry of timeline.entries) {
        knots.push(entry.enteredMs);
        knots.push(entry.exitedMs ?? timeline.endMs);
    }
    const realKnots = knots
        .filter((value) => value >= timeline.startMs && value <= timeline.endMs)
        .sort((left, right) => left - right)
        .filter((value, index, all) => index === 0 || value !== all[index - 1]);

    const realSpan = Math.max(1, timeline.endMs - timeline.startMs);
    const displayKnots: number[] = [0];
    for (let index = 1; index < realKnots.length; index++) {
        const interval = realKnots[index] - realKnots[index - 1];
        const step = proportional
            ? (interval / realSpan) * PROPORTIONAL_TOTAL_MS
            : compressInterval(interval);
        displayKnots.push(displayKnots[index - 1] + step);
    }
    const displayTotal = displayKnots[displayKnots.length - 1] || 1;

    /** Interpolate `value` from one knot series onto the other. */
    const project = (value: number, from: number[], to: number[]): number => {
        if (value <= from[0]) return to[0];
        const last = from.length - 1;
        if (value >= from[last]) return to[last];
        let index = 1;
        while (index < last && from[index] < value) index++;
        const span = from[index] - from[index - 1];
        const fraction = span === 0 ? 0 : (value - from[index - 1]) / span;
        return to[index - 1] + (to[index] - to[index - 1]) * fraction;
    };

    return {
        displayAt: (realMs) => project(realMs, realKnots, displayKnots),
        displayTotal,
        realAt: (displayMs) => project(displayMs, displayKnots, realKnots),
    };
}

/**
 * The `from->to` half of an edge id, which is `${from}->${to}#${type}#${ordinal}`.
 *
 * Everything before the last two `#` segments, not before the first: a state name may
 * itself contain `#`, and splitting on the first one would silently stop painting that
 * edge as taken - the same trap `computeExecutionStyling` documents (issue #79).
 */
function edgePairOf(edgeId: string): string {
    const parts = edgeId.split('#');
    return parts.slice(0, Math.max(1, parts.length - 2)).join('#');
}

/** Format a real duration as `1.2s`, matching the overlay's own annotations. */
function formatSeconds(ms: number): string {
    if (ms < 1000) return Math.round(ms) + 'ms';
    return (ms / 1000).toFixed(ms < 10_000 ? 1 : 0) + 's';
}

/** The status a state holds at `realMs`, or `null` for one that has not run yet. */
function statusAt(entries: TimelineEntry[], realMs: number): string | null {
    let latest: TimelineEntry | null = null;
    for (const entry of entries) {
        if (entry.enteredMs > realMs) continue;
        if (entry.exitedMs === undefined || entry.exitedMs > realMs) return 'active';
        if (!latest || entry.exitedMs >= (latest.exitedMs ?? 0)) latest = entry;
    }
    return latest ? latest.status : null;
}

/**
 * Wire up execution playback for a viewer instance.
 *
 * @param params - Playback parameters
 * @param params.timeline - The execution timeline to replay; omit for an inert controller
 * @returns The playback controls, all no-ops without a timeline
 */
export function createPlayback(params: CreatePlaybackParams): Playback {
    const { content, ownerDoc, registry, root, stage, timeline, viewport } = params;
    const bar = hook(root, 'playback');
    const inert: Playback = {
        enabled: false,
        handleKey: () => false,
        retire: () => {},
        stop: () => {},
    };
    if (!timeline || timeline.entries.length === 0 || !bar) return inert;

    const view = ownerDoc?.defaultView ?? null;
    const playButton = hook(root, 'playback-play');
    const scrubber = hook(root, 'playback-scrub') as HTMLInputElement | null;
    const timeLabel = hook(root, 'playback-time');
    const entryLabel = hook(root, 'playback-entry');

    // Entries grouped by the node they ran on, so a paint is one pass per node rather
    // than a scan of the whole timeline per node.
    const entriesByNodeId = new Map<string, TimelineEntry[]>();
    for (const entry of timeline.entries) {
        const forNode = entriesByNodeId.get(entry.nodeId) ?? [];
        forNode.push(entry);
        entriesByNodeId.set(entry.nodeId, forNode);
    }
    // The instants a step lands on: where something started running.
    const stepInstants = timeline.entries
        .map((entry) => entry.enteredMs)
        .sort((left, right) => left - right)
        .filter((value, index, all) => index === 0 || value !== all[index - 1]);

    let scale = buildTimeScale(timeline, false);
    let displayMs = 0;
    let playing = false;
    let speed = 1;
    let proportional = false;
    let autoPanSuspended = false;
    let selfPanning = false;
    let frameHandle = 0;
    let lastFrameMs = 0;
    let paintedNodes: Element[] = [];
    let paintedEdges: Element[] = [];
    let paintedSvg: SVGSVGElement | null = null;
    let lastActiveNodeId: string | null = null;

    /**
     * Drop every class playback applied, leaving the served overlay untouched.
     *
     * Swept across the whole content node rather than the cached targets: a document
     * with a container ships two views and only the visible one is ever painted, so
     * classes left on the other by a mid-replay collapse toggle would otherwise freeze
     * it at that playhead until the next render.
     */
    const clearPaint = (): void => {
        const painted = content.querySelectorAll(PAINTED_SELECTOR);
        for (let index = 0; index < painted.length; index++) {
            painted[index].classList.remove(...STATUS_CLASSES, 'sfn-exec-taken', 'sfn-exec-untaken');
        }
        content.classList.remove(PLAYING_CLASS);
        lastActiveNodeId = null;
    };

    /** Re-read the nodes and edges to paint whenever the visible view changed. */
    const syncTargets = (): void => {
        const svg = viewport.activeSvg();
        if (svg === paintedSvg) return;
        // The view being left behind keeps whatever it was painted with, so wipe first.
        if (paintedSvg) clearPaint();
        paintedSvg = svg;
        paintedNodes = svg ? Array.prototype.slice.call(svg.querySelectorAll('[data-state-id]')) : [];
        paintedEdges = svg ? Array.prototype.slice.call(svg.querySelectorAll('[data-edge-id]')) : [];
        lastActiveNodeId = null;
    };

    /** Paint every state and edge with the status it held at `realMs`. */
    const paint = (realMs: number): void => {
        syncTargets();
        content.classList.add(PLAYING_CLASS);

        let activeGroup: Element | null = null;
        let activeNodeId: string | null = null;
        for (const node of paintedNodes) {
            const nodeId = node.getAttribute('data-state-id') ?? '';
            const entries = entriesByNodeId.get(nodeId);
            const status = entries ? statusAt(entries, realMs) : null;
            node.classList.remove(...STATUS_CLASSES);
            node.classList.add(status ? 'sfn-exec-' + status : 'sfn-exec-pending');
            // A container is active for its whole run, so prefer a leaf for auto-pan:
            // the last one found is the innermost thing that started.
            if (status === 'active') {
                activeGroup = node;
                activeNodeId = nodeId;
            }
        }

        // An edge counts as taken once the run it led into has begun.
        const takenPairs = new Set<string>();
        for (const entry of timeline.entries) {
            if (entry.enteredMs <= realMs && entry.fromNodeId !== undefined) {
                takenPairs.add(entry.fromNodeId + '->' + entry.nodeId);
            }
        }
        for (const edge of paintedEdges) {
            const taken = takenPairs.has(edgePairOf(edge.getAttribute('data-edge-id') ?? ''));
            edge.classList.toggle('sfn-exec-taken', taken);
            edge.classList.toggle('sfn-exec-untaken', !taken);
        }

        if (activeGroup && activeNodeId !== lastActiveNodeId && !autoPanSuspended) {
            lastActiveNodeId = activeNodeId;
            selfPanning = true;
            viewport.centerOn(activeGroup);
            selfPanning = false;
        }
        updateReadout(realMs);
    };

    /** Refresh the scrubber, the clock, and the "what is running" line. */
    const updateReadout = (realMs: number): void => {
        if (scrubber) {
            scrubber.value = String(Math.round((displayMs / scale.displayTotal) * 1000));
        }
        if (timeLabel) {
            timeLabel.textContent =
                formatSeconds(realMs - timeline.startMs) +
                ' / ' +
                formatSeconds(timeline.endMs - timeline.startMs);
        }
        if (!entryLabel) return;
        const started = timeline.entries.filter((entry) => entry.enteredMs <= realMs);
        const running = started.filter(
            (entry) => entry.exitedMs === undefined || entry.exitedMs > realMs,
        );
        // Whatever is running, else whatever ran most recently - so a playhead resting
        // between two entries still says what just happened.
        const current = running[running.length - 1] ?? started[started.length - 1];
        if (!current) {
            entryLabel.textContent = '';
            return;
        }
        const parts = [current.stateName];
        if (current.attempt > 1) parts.push('attempt ' + current.attempt);
        // A run that has not ended by now has no outcome yet: showing the status or
        // error it will end with would leak the rest of the replay.
        if (running.indexOf(current) === -1) {
            parts.push(current.status);
            if (current.error) parts.push(current.error);
        }
        entryLabel.textContent = parts.join(' · ');
    };

    /**
     * Move the playhead to a display position and repaint. A non-finite position (an
     * instant speed's `0 * Infinity`) means the end of the run, not a stuck playhead:
     * `Math.min` would otherwise carry `NaN` through every later comparison.
     */
    const seek = (nextDisplayMs: number): void => {
        displayMs = Number.isFinite(nextDisplayMs)
            ? Math.max(0, Math.min(scale.displayTotal, nextDisplayMs))
            : scale.displayTotal;
        paint(scale.realAt(displayMs));
    };

    /** Settle at the end of the run: the static overlay, exactly as it was served. */
    const finish = (): void => {
        setPlaying(false);
        displayMs = scale.displayTotal;
        clearPaint();
        updateReadout(timeline.endMs);
    };

    const stopFrames = (): void => {
        if (frameHandle && view) view.cancelAnimationFrame(frameHandle);
        frameHandle = 0;
    };

    const setPlaying = (next: boolean): void => {
        // Without a window there are no animation frames to drive a replay, so claiming
        // to play would leave the button reading "Pause" over a playhead that never moves.
        const canPlay = next && view !== null;
        playing = canPlay;
        if (playButton) {
            playButton.textContent = playing ? '❚❚' : '▶';
            playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        }
        if (!playing) {
            stopFrames();
            return;
        }
        // Restarting from the end replays from the top rather than sitting there.
        if (displayMs >= scale.displayTotal) seek(0);
        autoPanSuspended = false;
        lastFrameMs = 0;
        const advance = (now: number): void => {
            const elapsed = lastFrameMs === 0 ? 0 : now - lastFrameMs;
            lastFrameMs = now;
            // `elapsed * Infinity` is NaN on the first frame, where elapsed is 0 - the
            // instant speed means "all of it now" rather than "no distance at all".
            seek(Number.isFinite(speed) ? displayMs + elapsed * speed : scale.displayTotal);
            if (displayMs >= scale.displayTotal) {
                finish();
                return;
            }
            frameHandle = view!.requestAnimationFrame(advance);
        };
        frameHandle = view!.requestAnimationFrame(advance);
    };

    /**
     * Jump to the entry start before or after the playhead.
     *
     * The epsilon only has to clear the rounding of a display-time round trip, so it
     * stays well under a millisecond: history timestamps have millisecond resolution,
     * and a 1ms margin would make two states a millisecond apart unreachable in either
     * direction.
     */
    const step = (direction: -1 | 1): void => {
        setPlaying(false);
        const realMs = scale.realAt(displayMs);
        const target =
            direction === 1
                ? stepInstants.find((instant) => instant > realMs + STEP_EPSILON_MS)
                : stepInstants
                      .slice()
                      .reverse()
                      .find((instant) => instant < realMs - STEP_EPSILON_MS);
        if (direction === 1 && target === undefined) {
            // Stepping past the last thing that ran ends the replay, same as playing out.
            finish();
            return;
        }
        seek(scale.displayAt(target ?? timeline.startMs));
    };

    /** Swap the time model, keeping the playhead on the same real instant. */
    const setProportional = (next: boolean): void => {
        const realMs = scale.realAt(displayMs);
        proportional = next;
        scale = buildTimeScale(timeline, proportional);
        seek(scale.displayAt(realMs));
    };

    const setSpeed = (next: number): void => {
        speed = next;
        for (const button of Array.prototype.slice.call(bar.querySelectorAll('[data-sfn-speed]')) as Element[]) {
            const value = button.getAttribute('data-sfn-speed');
            button.setAttribute('aria-pressed', String(Number(value) === next));
        }
    };

    registry.on(bar, 'click', (event) => {
        // Retired controls stay inert even if a host leaves the bar on screen: the
        // timeline no longer describes what is rendered, so a replay would grey it out.
        if (!controls.enabled) return;
        const target = event.target instanceof Element ? event.target : null;
        const control = target?.closest('[data-sfn-playback], [data-sfn-speed]');
        if (!control) return;

        const speedValue = control.getAttribute('data-sfn-speed');
        if (speedValue) {
            setSpeed(Number(speedValue));
            return;
        }
        const action = control.getAttribute('data-sfn-playback');
        if (action === 'toggle') setPlaying(!playing);
        else if (action === 'next') step(1);
        else if (action === 'prev') step(-1);
        else if (action === 'proportional') {
            const next = !proportional;
            control.setAttribute('aria-pressed', String(next));
            setProportional(next);
        }
    });

    if (scrubber) {
        registry.on(scrubber, 'input', () => {
            if (!controls.enabled) return;
            // Every frame writes the thumb's position back, so a replay still running
            // would drag it out from under the pointer.
            setPlaying(false);
            autoPanSuspended = true;
            seek((Number(scrubber.value) / 1000) * scale.displayTotal);
        });
    }

    // A pan or zoom by hand during playback hands the viewport back to the user; the
    // next play resumes following the run.
    const suspendAutoPan = (): void => {
        if (!selfPanning) autoPanSuspended = true;
    };
    registry.on(stage, 'pointerdown', suspendAutoPan);
    registry.on(stage, 'wheel', suspendAutoPan);
    registry.cleanups.push(stopFrames);

    setSpeed(1);
    updateReadout(timeline.startMs);

    const controls: Playback = {
        enabled: true,
        handleKey(key: string): boolean {
            if (!controls.enabled) return false;
            if (key === ' ') {
                setPlaying(!playing);
                return true;
            }
            if (key === 'ArrowRight') {
                step(1);
                return true;
            }
            if (key === 'ArrowLeft') {
                step(-1);
                return true;
            }
            if (key === 'Home') {
                setPlaying(false);
                seek(0);
                return true;
            }
            if (key === 'End') {
                finish();
                return true;
            }
            return false;
        },
        retire(): void {
            controls.stop();
            controls.enabled = false;
            bar.hidden = true;
        },
        stop(): void {
            setPlaying(false);
            displayMs = 0;
            clearPaint();
            updateReadout(timeline.startMs);
        },
    };

    return controls;
}
