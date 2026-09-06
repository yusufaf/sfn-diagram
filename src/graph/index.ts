export { applyCollapse, computeCollapsePlan } from './collapseContainers';
export type {
    ApplyCollapseParams,
    CollapsePlan,
    ComputeCollapsePlanParams,
} from './collapseContainers';
export { applyCatchHandling } from './catchHandling';
export type { ApplyCatchHandlingParams } from './catchHandling';
export { getMapProcessor, isOpenContainer } from './containers';
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
