import { getMapProcessor } from './containers';
import type { AslDefinition } from '../types';
import { replaceXmlForbiddenChars } from '../utils/xmlChars';

/**
 * Identifies one `States` block. Empty at the machine root; otherwise the resolved id
 * of the owning container plus the branch or processor it belongs to.
 */
export type ScopePath = string;

/** Resolves ASL state names to graph node ids, disambiguating names that repeat. */
export interface IdResolver {
    /** Scope path for a Parallel branch of the container named `containerName` in `scope`. */
    branchScope(scope: ScopePath, containerName: string, index: number): ScopePath;
    /** Scope path for the Map processor of the container named `containerName` in `scope`. */
    processorScope(scope: ScopePath, containerName: string): ScopePath;
    /**
     * Every node id assigned to the state name `name`, across all scopes.
     *
     * The inverse of {@link IdResolver.resolve}, for callers holding a bare name with
     * no scope to resolve it in — an execution history records only
     * `stateEnteredEventDetails.name`, so a duplicated name genuinely means "any of
     * these nodes".
     */
    idsForName(name: string): string[];
    /** The node id for the state named `name` as seen from `scope`. */
    resolve(scope: ScopePath, name: string): string;
}

/** Parameters for {@link buildIdResolver}. */
export interface BuildIdResolverParams {
    /** The ASL definition whose scopes are being indexed. */
    definition: AslDefinition;
}

/** Separator between a scope path and a state name, and between path segments. */
const SCOPE_SEPARATOR = '__';

/** Key for the assignment map. NUL cannot appear in either half. */
function assignmentKey(scope: ScopePath, name: string): string {
    return `${scope}\u0000${name}`;
}

/**
 * Id of the virtual end marker a Parallel container's branch collects its ends into.
 *
 * The one place this format is defined — `AslParser.ts` and {@link reservedIdsFor}
 * both call this rather than keeping their own copy of the template, so the two
 * traversals that have to agree on ids (nodes vs. edges) cannot drift apart on it.
 */
export function branchEndMarkerId(containerId: string, branchIndex: number): string {
    return `${containerId}${SCOPE_SEPARATOR}branch${branchIndex}${SCOPE_SEPARATOR}end`;
}

/** Id of the virtual end marker a Map container's inline iterator ends collect into. */
export function iteratorEndMarkerId(containerId: string): string {
    return `${containerId}${SCOPE_SEPARATOR}iterator${SCOPE_SEPARATOR}end`;
}

/** Id suffix for a Distributed Map's ItemReader satellite node. */
export const ITEM_READER_ID_SUFFIX: string = `${SCOPE_SEPARATOR}itemreader`;

/** Id suffix for a Distributed Map's ResultWriter satellite node. */
export const RESULT_WRITER_ID_SUFFIX: string = `${SCOPE_SEPARATOR}resultwriter`;

/**
 * Every id this state reserves beyond its own: the virtual end markers a container
 * gets per branch or processor, and a Distributed Map's I/O satellites.
 *
 * Reserved up front so a state whose *name* happens to collide with one of them — a
 * branch containing a state literally called `end` produces the same candidate id as
 * that branch's own `__branchN__end` marker — is pushed aside rather than silently
 * overwriting it.
 */
function reservedIdsFor(id: string, definition: AslDefinition, name: string): string[] {
    const state = definition.States[name];
    const reserved: string[] = [];

    if (state.Type === 'Parallel' && Array.isArray(state.Branches)) {
        state.Branches.forEach((_, index) => reserved.push(branchEndMarkerId(id, index)));
    }
    if (state.Type === 'Map') {
        if (getMapProcessor(state) !== undefined) {
            reserved.push(iteratorEndMarkerId(id));
        }
        if (state.ItemReader?.Resource) reserved.push(`${id}${ITEM_READER_ID_SUFFIX}`);
        if (state.ResultWriter?.Resource) reserved.push(`${id}${RESULT_WRITER_ID_SUFFIX}`);
    }

    return reserved;
}

/**
 * Index a definition's state names and hand back a resolver that turns each one into a
 * node id, unique across the whole graph.
 *
 * ASL only requires a state name to be unique within its own `States` block, so two
 * Parallel branches may each contain a `Validate`. Using the bare name as the node id
 * collapsed them onto one node, giving dagre an ambiguous graph and every edge to
 * `Validate` an ambiguous target — a silently wrong diagram.
 *
 * Three rules, in order:
 *
 * 1. **A name that occurs in only one scope keeps it.** That is the compatibility
 *    guarantee: `data-state-id`, and therefore `nodeOverrides`, `nodeAnnotations` and
 *    (via `edgeIdentity`) `edgeOverrides`, are unchanged for every definition that is
 *    not currently rendered wrong.
 * 2. **On a collision, the root-scope occurrence keeps the bare name** and nested ones
 *    are qualified with their scope. Asymmetric on purpose — the outer state is the one
 *    most likely to appear in a caller's override map.
 * 3. **Anything still colliding gets a numeric discriminator.** ASL permits arbitrary
 *    characters in a state name, so no separator is collision-proof; uniqueness is
 *    enforced against the ids already taken rather than assumed from the scheme.
 *
 * A character XML forbids becomes U+FFFD in the id, as the SVG escapers write it, so a
 * rendered `data-state-id` always equals the id the viewer and overlays look up. Two
 * names that differ only in such characters then fall to rule 3.
 *
 * Scopes are indexed outermost-first, so a nested id is only ever built from an already
 * resolved container id, and every marker a level reserves is taken before the next
 * level's names are assigned.
 *
 * @param params - Object parameters
 * @param params.definition - The ASL definition whose scopes are being indexed
 * @returns A resolver for node ids and scope paths
 *
 * @example
 * ```typescript
 * const resolver = buildIdResolver({ definition: asl });
 * const branch = resolver.branchScope('', 'Fanout', 0);
 * resolver.resolve(branch, 'Validate'); // 'Fanout__branch0__Validate' when it collides
 * resolver.resolve('', 'Validate');     // 'Validate'
 * ```
 */
export function buildIdResolver(params: BuildIdResolverParams): IdResolver {
    const { definition } = params;

    // Pass 1: which scopes does each bare name appear in?
    //
    // Paths here are structural - an array of steps, keyed by its JSON - rather than
    // the `__`-joined strings pass 2 builds from resolved ids. Concatenating names with
    // a separator that is itself legal inside a name can conflate two genuinely
    // different scopes (a root state literally named `A__branch0__C` versus branch 0 of
    // a Parallel `A` containing `C`), which would undercount the collision and skip the
    // qualification. JSON of the step array cannot collide.
    const scopesByName = new Map<string, Set<string>>();
    const walk = (current: AslDefinition, path: string[]): void => {
        const scopeKey = JSON.stringify(path);

        for (const [name, state] of Object.entries(current.States)) {
            const scopes = scopesByName.get(name) ?? new Set<string>();
            scopes.add(scopeKey);
            scopesByName.set(name, scopes);

            if (state.Type === 'Parallel' && Array.isArray(state.Branches)) {
                state.Branches.forEach((branch, index) =>
                    walk(branch, [...path, name, `branch${index}`])
                );
            }
            if (state.Type === 'Map') {
                const processor = getMapProcessor(state);
                if (processor) walk(processor, [...path, name, 'iterator']);
            }
        }
    };
    walk(definition, []);

    // Pass 2: assign ids outermost-first, reserving each level's markers before the
    // next level's names are resolved against them.
    const assigned = new Map<string, string>();
    // Reverse index for callers holding a bare name. Built here rather than derived
    // from `assigned`'s keys afterwards: those keys join scope and name, and a state
    // name may itself contain the separator, so they cannot be split back apart.
    const idsByName = new Map<string, string[]>();
    const taken = new Set<string>();
    let frontier: Array<{ definition: AslDefinition; scope: ScopePath }> = [
        { definition, scope: '' },
    ];

    while (frontier.length > 0) {
        const next: Array<{ definition: AslDefinition; scope: ScopePath }> = [];

        for (const frame of frontier) {
            const assign = (name: string): string => {
                const collides = (scopesByName.get(name)?.size ?? 1) > 1;
                const safeName = replaceXmlForbiddenChars(name);
                const candidate =
                    collides && frame.scope !== '' ? `${frame.scope}${SCOPE_SEPARATOR}${safeName}` : safeName;

                let id = candidate;
                for (let suffix = 2; taken.has(id); suffix++) {
                    id = `${candidate}${SCOPE_SEPARATOR}${suffix}`;
                }

                assigned.set(assignmentKey(frame.scope, name), id);
                idsByName.set(name, [...(idsByName.get(name) ?? []), id]);
                taken.add(id);
                return id;
            };

            // Containers first, so their markers and satellites are reserved before any
            // plain state can claim one of those ids. The extractor builds a marker id
            // as `${containerId}__branchN__end` unconditionally, with no chance to take
            // a discriminator, so it is the plain state that has to move aside - and it
            // only does that if the marker is already in `taken` when it is assigned.
            const names = Object.keys(frame.definition.States);
            const isContainer = (name: string): boolean => {
                const type = frame.definition.States[name].Type;
                return type === 'Parallel' || type === 'Map';
            };

            for (const name of names.filter(isContainer)) {
                const id = assign(name);
                for (const reserved of reservedIdsFor(id, frame.definition, name)) {
                    taken.add(reserved);
                }
            }
            for (const name of names.filter((candidate) => !isContainer(candidate))) {
                assign(name);
            }

            // Enqueue nested scopes only after every name at this level has an id, so a
            // child scope path is always built from a resolved container id.
            for (const [name, state] of Object.entries(frame.definition.States)) {
                const containerId = assigned.get(assignmentKey(frame.scope, name))!;

                if (state.Type === 'Parallel' && Array.isArray(state.Branches)) {
                    state.Branches.forEach((branch, index) =>
                        next.push({
                            definition: branch,
                            scope: `${containerId}__branch${index}`,
                        })
                    );
                }
                if (state.Type === 'Map') {
                    const processor = getMapProcessor(state);
                    if (processor) {
                        next.push({ definition: processor, scope: `${containerId}__iterator` });
                    }
                }
            }
        }

        frontier = next;
    }

    return {
        branchScope: (scope, containerName, index) =>
            `${resolveIn(scope, containerName)}__branch${index}`,
        idsForName: (name) => idsByName.get(name) ?? [],
        processorScope: (scope, containerName) => `${resolveIn(scope, containerName)}__iterator`,
        resolve: resolveIn,
    };

    /**
     * Falls back to the bare name for anything not indexed — a transition target that
     * does not exist is the validator's problem, not this function's, and returning
     * the name keeps the resulting dangling edge readable.
     */
    function resolveIn(scope: ScopePath, name: string): string {
        return assigned.get(assignmentKey(scope, name)) ?? replaceXmlForbiddenChars(name);
    }
}
