export { applyCollapse, computeCollapsePlan } from './collapseContainers';
export type {
    ApplyCollapseParams,
    CollapsePlan,
    ComputeCollapsePlanParams,
} from './collapseContainers';
export { applyCatchHandling } from './catchHandling';
export type { ApplyCatchHandlingParams } from './catchHandling';
export { getMapProcessor, isMarkerNode, isOpenContainer, MARKER_NODE_TYPES } from './containers';
export { flattenMarkers } from './flattenMarkers';
export type { FlattenMarkersParams, FlattenMarkersResult } from './flattenMarkers';
export { assignEdgeIds } from './edgeIdentity';
export type { AssignEdgeIdsParams, RawEdge } from './edgeIdentity';
export {
    branchEndMarkerId,
    buildIdResolver,
    ITEM_READER_ID_SUFFIX,
    iteratorEndMarkerId,
    RESULT_WRITER_ID_SUFFIX,
} from './scopeIds';
export type { BuildIdResolverParams, IdResolver, ScopePath } from './scopeIds';
