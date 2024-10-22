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

import { ConnectivityGraph, ConnectivityKnowledge, KnowledgeNode } from './graph'

//==============================================================================

const MIN_SCHEMA_VERSION = 1.3

//==============================================================================

type DataValues = {
    values: any[]
}

type SchemaVersion = {
    version: number
}

type SourceList = {
    sources: string[]
}

//==============================================================================

export class App
{
    #connectivityGraph: ConnectivityGraph|null
    #currentPath: string = ''
    #knowledgeByPath: Map<string, ConnectivityKnowledge> = new Map()
    #labelCache: Map<string, string> = new Map()
    #labelledTerms: Set<string> = new Set()
    #mapServer: string
    #pathPrompt: HTMLElement
    #pathSelector: HTMLElement
    #sourceSelector: HTMLElement
    #spinner: HTMLElement

    constructor(mapServer: string)
    {
        this.#mapServer = mapServer
        this.#pathPrompt = document.getElementById('path-prompt')
        this.#pathSelector = document.getElementById('path-selector')
        this.#sourceSelector = document.getElementById('source-selector')
        this.#spinner = document.getElementById('spinner')
    }

    async run()
    //=========
    {
        const schemaVersion = await this.#getSchemaVersion()
        if (schemaVersion < MIN_SCHEMA_VERSION) {
            this.#showElement(document.getElementById('no-server'))
            return
        }
        this.#showSpinner()
        const selectedSource = await this.#setSourceList()
        this.#sourceSelector.onchange = async (e) => {
            // @ts-ignore
            if (e.target.value !== '') {
                // @ts-ignore
                await this.#setPathList(e.target.value)
                if (!this.#selectPath(this.#currentPath)) {
                    this.#clearConnectivity()
                }
            }
        }
        await this.#setPathList(selectedSource)
        this.#pathSelector.onchange = async (e) => {
            // @ts-ignore
            if (e.target.value !== '') {
                // @ts-ignore
                await this.#showGraph(e.target.value)
            } else {
                this.#clearConnectivity()
            }
        }
        this.#hideSpinner()
        this.#showPrompt()
    }


    async #getJsonData<T>(url: string): Promise<T|null>
    //=================================================
    {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    "Accept": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                    "Content-Type": "application/json"
                }
            })
            if (!response.ok) {
                console.error(`Cannot access ${url}`)
            }
            return await response.json()
        } catch {
            return null
        }
    }

    async #getSchemaVersion(): Promise<number>
    //========================================
    {
        const data = await this.#getJsonData<SchemaVersion>(`${this.#mapServer}knowledge/schema-version`)
        return data ? (+data.version || 0) : 0
    }

    async #showGraph(neuronPath: string)
    //==================================
    {
        this.#hidePrompt()
        this.#showSpinner()
        this.#connectivityGraph = new ConnectivityGraph(this.#labelCache)
        await this.#connectivityGraph.addConnectivity(this.#knowledgeByPath.get(neuronPath))
        this.#hideSpinner()
        this.#connectivityGraph.showConnectivity()
        this.#currentPath = neuronPath
    }

    #clearConnectivity()
    //==================
    {
        if (this.#connectivityGraph) {
            this.#connectivityGraph.clearConnectivity()
            this.#connectivityGraph = null
            this.#showPrompt()
        }
        this.#currentPath = ''
    }

    #showElement(element: HTMLElement, show: boolean=true)
    //====================================================
    {
        element.style.display = show ? 'block' : 'none'
    }

    #hidePrompt()
    //===========
    {
        this.#showElement(this.#pathPrompt, false)
    }
    #showPrompt()
    //===========
    {
        this.#showElement(this.#pathPrompt)
    }

    #hideSpinner()
    //============
    {
        this.#showElement(this.#spinner, false)
    }
    #showSpinner()
    //============
    {
        this.#showElement(this.#spinner)
    }

    async #query(sql: string, params: string[]=[]): Promise<DataValues>
    //=================================================================
    {
        const url = `${this.#mapServer}knowledge/query/`
        const query = { sql, params }
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    "Accept": "application/json; charset=utf-8",
                    "Cache-Control": "no-store",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(query)
            })
            if (!response.ok) {
                throw new Error(`Cannot access ${url}`)
            }
            return await response.json()
        } catch {
            return {
                values: []
            }
        }
    }

    async #getCachedTermLabels()
    //==========================
    {
        if (this.#labelledTerms.size) {
            const data = await this.#query(
                `select entity, knowledge from knowledge
                    where entity in (?${', ?'.repeat(this.#labelledTerms.size-1)})
                    order by source desc`,
                [...this.#labelledTerms.values()])
            let last_entity = null
            for (const [key, jsonKnowledge] of data.values) {
                if (key !== last_entity) {
                    const knowledge = JSON.parse(jsonKnowledge)
                    this.#labelCache.set(key, knowledge['label'] || key)
                    last_entity = key
                }
            }
        }
    }

    #cacheNodeLabels(node: KnowledgeNode)
    //===================================
    {
        for (const term of [node[0], ...node[1]]) {
            this.#labelledTerms.add(term)
        }
    }

    async #cacheLabels(knowledge: ConnectivityKnowledge)
    //==================================================
    {
        for (const edge of knowledge.connectivity) {
            this.#cacheNodeLabels(edge[0])
            this.#cacheNodeLabels(edge[1])
        }
    }

    #selectPath(neuronPath: string): boolean
    //======================================
    {
        if (this.#knowledgeByPath.has(neuronPath)) {
            const optionElement = this.#pathSelector.querySelector(`option[value="${neuronPath}"]`) as HTMLOptionElement
            if (optionElement) {
                optionElement.selected = true
                return true
            }
        }
        return false
    }

    async #setPathList(source: string): Promise<string>
    //=================================================
    {
        const data = await this.#query(
            `select entity, knowledge from knowledge
                where entity like 'ilxtr:%' and source=?
                order by entity`,
            [source])
        const pathList: string[] = ['<option value="">Please select path:</option>']
        this.#knowledgeByPath.clear()
        this.#labelledTerms = new Set()
        for (const [key, jsonKnowledge] of data.values) {
            const knowledge = JSON.parse(jsonKnowledge)
            if ('connectivity' in knowledge) {
                const label = knowledge.label || key
                const shortLabel = (label === key.slice(6).replace('-prime', "'").replaceAll('-', ' ')) ? ''
                                 : (label.length < 50) ? label : `${label.slice(0, 50)}...`
                pathList.push(`<option value="${key}" label="${key}&nbsp;&nbsp;${shortLabel}"></option>`)
                this.#knowledgeByPath.set(key, knowledge)
                this.#cacheLabels(knowledge)
            }
        }
        await this.#getCachedTermLabels()
        this.#pathSelector.innerHTML = pathList.join('')
        return ''
    }

    async #setSourceList(): Promise<string>
    //=====================================
    {
        const data = await this.#getJsonData<SourceList>(`${this.#mapServer}knowledge/sources`)
        const sources = data ? (data.sources || []) : []

        // Order with most recent first...
        let firstSource = ''
        const sourceList: string[] = []
        for (const source of sources) {
            if (source) {
                sourceList.push(`<option value="${source}">${source}</option>`)
                if (firstSource === '') {
                    firstSource = source
                }
            }
        }
        this.#sourceSelector.innerHTML = sourceList.join('')
        return firstSource
    }
}

//==============================================================================
