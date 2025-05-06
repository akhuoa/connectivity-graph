/*==============================================================================

A viewer for neuron connectivity graphs.

Copyright (c) 2019 - 2024  David Brooks

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

==============================================================================*/

import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
cytoscape.use( dagre );

//==============================================================================

export type KnowledgeNode = [string, string[]]

type KnowledgeEdge = [KnowledgeNode, KnowledgeNode]

export interface ConnectivityKnowledge
{
    connectivity: KnowledgeEdge[]
    axons: KnowledgeNode[]
    dendrites: KnowledgeNode[]
    somas: KnowledgeNode[]
}

//==============================================================================

type GraphNode = {
    id: string
    label: string
    axon?: boolean
    dendrite?: boolean
    soma?: boolean
}

type GraphEdge = {
    id: string
    source: string
    target: string
}

//==============================================================================

export class ConnectivityGraph
{
    #cy: CytoscapeGraph|null = null
    #nodes: GraphNode[] = []
    #edges: GraphEdge[] = []
    #axons: string[]
    #dendrites: string[]
    #somas: string[] = []
    #labelCache: Map<string, string>

    constructor(labelCache: Map<string, string>)
    {
        this.#labelCache = labelCache
    }

    async addConnectivity(knowledge: ConnectivityKnowledge)
    //=====================================================
    {
        this.#axons = knowledge.axons.map(node => JSON.stringify(node))
        this.#dendrites = knowledge.dendrites.map(node => JSON.stringify(node))
        if ('somas' in knowledge) {
            this.#somas = knowledge.somas.map(node => JSON.stringify(node))
        }
        if (knowledge.connectivity.length) {
            for (const edge of knowledge.connectivity) {
                const e0 = await this.#graphNode(edge[0])
                const e1 = await this.#graphNode(edge[1])
                this.#nodes.push(e0)
                this.#nodes.push(e1)
                this.#edges.push({
                    id: `${e0.id}_${e1.id}`,
                    source: e0.id,
                    target: e1.id
                })
            }
        } else {
            this.#nodes.push({
                id: 'MISSING',
                label: 'NO PATHS'
            })
        }
    }

    showConnectivity(layout: string)
    //================
    {
        this.#cy = new CytoscapeGraph(this, layout)
    }

    clearConnectivity()
    //=================
    {
        if (this.#cy) {
            this.#cy.remove()
            this.#cy = null
        }
    }

    get elements()
    //============
    {
        return [
            ...this.#nodes.map(n => { return {data: n}}),
            ...this.#edges.map(e => { return {data: e}})
        ]
    }

    get roots(): string[]
    //===================
    {
        return [...this.#dendrites, ...this.#somas]
    }

    async #graphNode(node: KnowledgeNode): Promise<GraphNode>
    //=======================================================
    {
        const id = JSON.stringify(node)
        const label = [node[0], ...node[1]]
        const humanLabels: string[] = []
        for (const term of label) {
            const humanLabel = this.#labelCache.has(term) ? this.#labelCache.get(term) : ''
            humanLabels.push(humanLabel)
        }
        label.push(...humanLabels)

        const result = {
            id,
            label: label.join('\n')
        }
        if (this.#axons.includes(id)) {
            if (this.#dendrites.includes(id)) {
                result['both-a-d'] = true
            } else {
                result['axon'] = true
            }
        } else if (this.#somas.includes(id)) {
            result['soma'] = true
        } else if (this.#dendrites.includes(id)) {
            result['dendrite'] = true
        }
        return result
    }
}

//==============================================================================

const APP_PRIMARY_COLOR = '#8300bf'
const BG_COLOR = '#f3ecf6'
const GRAPH_STYLE = [
    {
        'selector': 'node',
        'style': {
            'label': function(ele) { return trimLabel(ele.data('label')) },
            // 'background-color': '#80F0F0',
            'background-color': 'transparent',
            'background-opacity': '0',
            'text-valign': 'center',
            'text-wrap': 'wrap',
            'width': '80px',
            'height': '80px',
            'text-max-width': '80px',
            'font-size': '6px',
            'shape': 'round-rectangle',
            'border-width': 1,
            'border-style': 'solid',
            'border-color': 'gray',
        }
    },
    {
        'selector': 'node[axon]',
        'style': {
            // 'background-color': 'green',
            'shape': 'round-diamond',
            'width': '100px',
            'height': '100px',
        }
    },
    {
        'selector': 'node[dendrite]',
        'style': {
            // 'background-color': 'red',
            'shape': 'ellipse',
        }
    },
    {
        'selector': 'node[somas]',
        'style': {
            // 'background-color': 'gray',
            'shape': 'round-rectangle',
        }
    },
    {
        'selector': 'edge',
        'style': {
            'width': 1,
            'line-color': 'dimgray',
            'curve-style': 'bezier'
        }
    },
    {
        'selector': 'node.active',
        'style': {
            'border-color': APP_PRIMARY_COLOR,
            'background-color': BG_COLOR,
            'background-opacity': 0.75,
        }
    }
]

function trimLabel(label: string) {
    const labels = label.split('\n')
    const half = labels.length/2
    const trimLabels = labels.slice(half)
    return capitalizeLabels(trimLabels.join('\n'))
}

function capitalizeLabels(input: string) {
    return input.split('\n').map(label => {
        if (label && label[0] >= 'a' && label[0] <= 'z') {
            return label.charAt(0).toUpperCase() + label.slice(1)
        }
        return label
    }).join('\n')
}

//==============================================================================

class CytoscapeGraph
{
    #cy
    #tooltip: HTMLElement

    constructor(connectivityGraph: ConnectivityGraph, layout: string)
    {
        const graphCanvas = document.getElementById('graph-canvas')
        let layoutOption = {}
        const layoutDefault = {
            name: 'breadthfirst',
            circle: false,
            roots: connectivityGraph.roots
        }
        const layoutBreadthfirstFix = {
            name: 'breadthfirst',
            directed: true,
            depthSort: function (a: any, b: any) {
                return a.data('id') - b.data('id');
            },
            roots: connectivityGraph.roots.length ? connectivityGraph.roots : undefined,
        }
        const layoutDagre = {
            name: 'dagre',
            nodeSep: 150,
            edgeSep: 50,
            rankSep: 100,
            rankDir: 'TB',
            roots: connectivityGraph.roots.length ? connectivityGraph.roots : undefined,
        }

        if (layout === 'breadthfirst-fix') {
            layoutOption = layoutBreadthfirstFix
        } else if (layout === 'dagre') {
            layoutOption = layoutDagre
        } else {
            layoutOption = layoutDefault
        }

        this.#cy = cytoscape({
            container: graphCanvas,
            elements: connectivityGraph.elements,
            layout: layoutOption,
            directed: true,
            style: GRAPH_STYLE
        }).on('mouseover', 'node', this.#overNode.bind(this))
          .on('mouseout', 'node', this.#exitNode.bind(this))
          .on('position', 'node', this.#moveNode.bind(this))

        this.#tooltip = document.createElement('div')
        this.#tooltip.id = 'tooltip'
        this.#tooltip.hidden = true
        graphCanvas!.lastChild!.appendChild(this.#tooltip)
    }

    remove()
    //======
    {
        if (this.#cy) {
            this.#cy.destroy()
        }
    }

    #checkRightBoundary(leftPos: number)
    //==================================
    {
        if ((leftPos + this.#tooltip.offsetWidth) >= this.#tooltip.parentElement!.offsetWidth) {
            this.#tooltip.style.left = `${leftPos - this.#tooltip.offsetWidth}px`
        }
    }

    #overNode(event)
    //==============
    {
        const node = event.target
        this.#tooltip.innerText = node.data().label
        this.#tooltip.style.left = `${event.renderedPosition.x}px`
        this.#tooltip.style.top = `${event.renderedPosition.y}px`
        this.#tooltip.hidden = false
        this.#checkRightBoundary(event.renderedPosition.x)
    }

    #moveNode(event)
    //==============
    {
        const node = event.target
        this.#tooltip.style.left = `${node.renderedPosition().x}px`
        this.#tooltip.style.top = `${node.renderedPosition().y}px`
        this.#checkRightBoundary(node.renderedPosition().x)
    }

    #exitNode(event)
    //==============
    {
        this.#tooltip.hidden = true
    }
}

//==============================================================================
