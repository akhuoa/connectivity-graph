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
const emptyConnectivity = {
    connectivity: [],
    axons: [],
    dendrites: [],
    somas: []
}

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
    #source: string
    #path: string
    #layout: string
    #pathPrompt: HTMLElement
    #pathSelector: HTMLSelectElement
    #sourceSelector: HTMLSelectElement
    #layoutSelector: HTMLSelectElement
    #pathSearch: HTMLInputElement
    #sourceFromMap: boolean
    #connectivityFromMap: ConnectivityKnowledge|null
    #spinner: HTMLElement

    constructor(mapServer: string, source: string, path: string, layout: string)
    {
        this.#mapServer = mapServer
        this.#source = source
        this.#path = path
        this.#layout = layout
        this.#pathPrompt = document.getElementById('path-prompt')
        this.#pathSelector = document.getElementById('path-selector') as HTMLSelectElement
        this.#sourceSelector = document.getElementById('source-selector') as HTMLSelectElement
        this.#layoutSelector = document.getElementById('layout-selector') as HTMLSelectElement
        this.#pathSearch = document.getElementById('path-search') as HTMLInputElement
        this.#spinner = document.getElementById('spinner')
        this.#sourceFromMap = source && !source.startsWith('sckan') ? true : false
        this.#connectivityFromMap = emptyConnectivity
    }

    async run()
    //=========
    {
        this.#disableTools()
        const schemaVersion = await this.#getSchemaVersion()
        if (schemaVersion < MIN_SCHEMA_VERSION) {
            this.#showElement(document.getElementById('no-server'))
            return
        }
        this.#showSpinner()
        const selectedSource = await this.#setSourceList(this.#source)

        this.#sourceSelector.onchange = async (e) => {
            const target = e.target as HTMLSelectElement
            this.#showSpinner()
            if (target.value !== '') {
                this.#source = target.value

                if (target.value.startsWith('sckan')) {
                    this.#sourceFromMap = false
                    await this.#setPathList(this.#source)
                    if (!this.#selectPath(this.#currentPath)) {
                        this.#clearConnectivity()
                    }
                } else {
                    this.#sourceFromMap = true
                    await this.#showGraph(this.#path, this.#layout)
                }

                this.#updateURL('source', this.#source)
                this.#hideSpinner()
            }
        }
        await this.#setPathList(selectedSource)
        this.#pathSelector.onchange = async (e) => {
            const target = e.target as HTMLSelectElement
            this.#showSpinner()
            if (target.value !== '') {
                this.#path = target.value
                await this.#showGraph(this.#path, this.#layout)
                this.#updateURL('path', this.#path)
            } else {
                this.#clearConnectivity()
                this.#showPrompt()
            }
            this.#hideSpinner()
        }
        if (this.#layout) {
            (this.#layoutSelector as HTMLSelectElement).value = this.#layout
        }
        this.#layoutSelector.onchange = async (e) => {
            const target = e.target as HTMLSelectElement
            this.#showSpinner()
            this.#layout = target.value
            await this.#showGraph(this.#path, this.#layout)
            this.#updateURL('layout', this.#layout)
            this.#hideSpinner()
        }
        this.#pathSearch.oninput = (e) => {
            const target = e.target as HTMLInputElement
            const searchValue = target.value.toLowerCase()
            const options = this.#pathSelector.options

            for (let i = 1; i < options.length; i++) {
              const option = options[i]
              const text = option.label.toLowerCase()
              const found = text.includes(searchValue) || text.includes(searchValue.split(/\s+/g).join('-'))
              option.style.display = !searchValue.trim().length || found ? '' : 'none'
            }
            if (searchValue.trim().length) {
              this.#pathSelector.size = 10
            } else {
              this.#pathSelector.size = 1
            }
            this.#pathSelector.addEventListener('blur', () => this.#pathSelector.size = 1)
            this.#pathSelector.addEventListener('change', () => this.#pathSelector.size = 1)
        }
        this.#hideSpinner()
        this.#enableTools()
        if (!this.#path) {
            this.#showPrompt()
        }
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

    async #showGraph(neuronPath: string, layout: string)
    //==================================
    {
        this.#showSpinner()
        let connectivityInfo = this.#knowledgeByPath.get(neuronPath)

        if (this.#sourceFromMap) {
            this.#connectivityFromMap = await this.#fetchMapConnectivity(this.#source, neuronPath)
            connectivityInfo = this.#connectivityFromMap

            // Update label data
            if (this.#connectivityFromMap.connectivity.length) {
                this.#cacheLabels(this.#connectivityFromMap);
                await this.#getCachedTermLabels();
            }
        }
        this.#connectivityGraph = new ConnectivityGraph(this.#labelCache)
        await this.#connectivityGraph.addConnectivity(connectivityInfo)
        this.#hideSpinner()
        this.#hidePrompt()
        this.#connectivityGraph.showConnectivity(layout)
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

    #disableTools()
    //=============
    {
        this.#pathSelector.disabled = true
        this.#layoutSelector.disabled = true
        this.#sourceSelector.disabled = true
        this.#pathSearch.disabled = true
    }
    #enableTools()
    //=============
    {
        this.#pathSelector.disabled = false
        this.#layoutSelector.disabled = false
        this.#sourceSelector.disabled = false
        this.#pathSearch.disabled = false
    }

    #updateURL(key: string, value: string)
    //====================================
    {
        const url = new URL(location.href)
        url.searchParams.set(key, value)
        history.pushState({}, '', url)
    }

    async #fetchMapConnectivity(mapuuid: string, pathId: string)
    //===========================================================
    {
        const url = this.#mapServer + `flatmap/${mapuuid}/connectivity/${pathId}`

        try {
            const response = await fetch(url)
            if (!response.ok) {
                return emptyConnectivity
            }
            return await response.json()
        } catch (error) {
            return emptyConnectivity
        }
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
        let selectedPath = ''
        this.#knowledgeByPath.clear()
        this.#labelledTerms = new Set()
        for (const [key, jsonKnowledge] of data.values) {
            const knowledge = JSON.parse(jsonKnowledge)
            if ('connectivity' in knowledge) {
                const label = knowledge.label || key
                const shortLabel = (label === key.slice(6).replace('-prime', "'").replaceAll('-', ' ')) ? ''
                                 : (label.length < 50) ? label : `${label.slice(0, 50)}...`
                if (this.#path && this.#path === key) {
                    pathList.push(`<option value="${key}" selected label="${key}&nbsp;&nbsp;${shortLabel}"></option>`)
                    selectedPath = key
                } else {
                    pathList.push(`<option value="${key}" label="${key}&nbsp;&nbsp;${shortLabel}"></option>`)
                }

                this.#knowledgeByPath.set(key, knowledge)
                this.#cacheLabels(knowledge)
            }
        }
        await this.#getCachedTermLabels()
        this.#pathSelector.innerHTML = pathList.join('')
        if (selectedPath) {
            await this.#showGraph(selectedPath, this.#layout)
        }
        return ''
    }

    async #setSourceList(selectedSource: string): Promise<string>
    //=====================================
    {
        const data = await this.#getJsonData<SourceList>(`${this.#mapServer}knowledge/sources`)
        const sources = data ? (data.sources || []) : []

        // Order with most recent first...
        let firstSource = ''
        const sourceList: string[] = []
        sourceList.push('<optgroup label="SCKAN Release:">')
        for (const source of sources) {
            if (source) {
                if (selectedSource && selectedSource === source) {
                    firstSource = source
                    sourceList.push(`<option value="${source}" selected>${source}</option>`)
                } else {
                    sourceList.push(`<option value="${source}">${source}</option>`)
                }
                if (firstSource === '') {
                    firstSource = source
                }
            }
        }
        sourceList.push('</optgroup>')
        sourceList.push('<optgroup label="MAP:">')
        const ratUUID = "b4ae1699-5690-5640-97b7-d711ae02dcb9"
        sourceList.push(`<option value="${ratUUID}" ${selectedSource === ratUUID ? 'selected' : ''}>Rat</option>`)
        sourceList.push('</optgroup">')
        this.#sourceSelector.innerHTML = sourceList.join('')
        return firstSource
    }
}

//==============================================================================
