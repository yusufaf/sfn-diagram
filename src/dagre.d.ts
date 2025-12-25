/* eslint-disable @typescript-eslint/no-explicit-any */
declare module '@dagrejs/dagre' {
    export namespace graphlib {
        class Graph {
            constructor(options?: { compound?: boolean; directed?: boolean; multigraph?: boolean });
            setGraph(options: any): void;
            setDefaultEdgeLabel(fn: () => any): void;
            setNode(id: string, value: any): void;
            setEdge(from: string, to: string, value?: any): void;
            setParent(childId: string, parentId: string): void;
            node(id: string): any;
            edge(from: string, to: string): any;
            graph(): any;
        }
    }

    export function layout(graph: graphlib.Graph): void;

    const dagre: {
        graphlib: typeof graphlib;
        layout: typeof layout;
    };

    export default dagre;
}
