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
const MAPS_TO_SHOW = [
    {
        name: 'Human Female',
        id: 'human-flatmap_female',
    },
    {
        name: 'Human Male',
        id: 'human-flatmap_male',
    },
    {
        name: 'Rat',
        id: 'rat-flatmap',
    },
    {
        name: 'Mouse',
        id: 'mouse-flatmap',
    },
    {
        name: 'Pig',
        id: 'pig-flatmap',
    },
    {
        name: 'Cat',
        id: 'cat-flatmap',
    },
]
const MAP_ENDPOINTS = {
    curation: 'https://mapcore-demo.org/curation/flatmap/',
    devel: 'https://mapcore-demo.org/devel/flatmap/v4/',
    staging: 'https://mapcore-demo.org/staging/flatmap/v1/',
    production: 'https://mapcore-demo.org/current/flatmap/v3/',
}
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
    #serverSelector: HTMLSelectElement
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
        this.#serverSelector = document.getElementById('server-selector') as HTMLSelectElement
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
        this.#setServerList()
        const schemaVersion = await this.#getSchemaVersion()
        if (schemaVersion < MIN_SCHEMA_VERSION) {
            this.#showElement(document.getElementById('no-server'))
            return
        }
        this.#showSpinner()

        await this.#setSourceList()
        await this.#setPathList()

        if (this.#layout) {
            (this.#layoutSelector as HTMLSelectElement).value = this.#layout
        }

        await this.#showGraph(this.#path, this.#layout)

        this.#hideSpinner()
        this.#enableTools()
        if (!this.#path) {
            this.#showPrompt()
        }

        this.#serverSelector.onchange = async (e) => {
            const target = e.target as HTMLSelectElement
            this.#showSpinner()
            this.#mapServer = target.value
            await this.#setSourceList()
            await this.#setPathList()
            await this.#showGraph(this.#path, this.#layout)
            this.#updateURL('server', this.#mapServer)
            this.#hideSpinner()
        }

        this.#sourceSelector.onchange = async (e) => {
            const target = e.target as HTMLSelectElement
            this.#showSpinner()
            if (target.value !== '') {
                this.#source = target.value

                if (target.value.startsWith('sckan')) {
                    this.#sourceFromMap = false
                    await this.#setPathList()
                    await this.#showGraph(this.#path, this.#layout)
                    if (!this.#selectPath(this.#currentPath)) {
                        this.#clearConnectivity()
                    }
                } else {
                    this.#sourceFromMap = true
                    await this.#setPathList()
                    await this.#showGraph(this.#path, this.#layout)
                }

                this.#updateURL('source', this.#source)
                this.#hideSpinner()
            }
        }

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
        if (this.#path) {
            this.#showSpinner()
            let connectivityInfo = this.#knowledgeByPath.get(this.#path)

            if (this.#sourceFromMap) {
                this.#connectivityFromMap = await this.#fetchMapConnectivity(this.#source, this.#path)
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
            this.#connectivityGraph.showConnectivity(this.#layout)
            this.#currentPath = this.#path
        } else {
            this.#showPrompt()
        }
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
        this.#serverSelector.disabled = true
        this.#pathSelector.disabled = true
        this.#layoutSelector.disabled = true
        this.#sourceSelector.disabled = true
        this.#pathSearch.disabled = true
    }
    #enableTools()
    //=============
    {
        this.#serverSelector.disabled = false
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

    async #queryMapPaths(): Promise<any>
    {
        const url = this.#mapServer + `flatmap/${this.#source}/pathways`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`Response status: ${response.status}`);
                return null
            }
            return await response.json();
        } catch (error) {
            console.error(error)
            return null
        }
    }

    async #setPathsFromMap()
    {
        const data = await this.#queryMapPaths()

        if (data?.paths) {
            const connectivityPaths = []
            for (const key in data.paths) {
                const item = data.paths[key]
                if (item.connectivity?.length) {
                    connectivityPaths.push(key)
                }
            }
            return connectivityPaths.map(item => ({
                value: item,
                label: '',
            }))
        } else {
            return []
        }
    }

    async #setPathsFromSCKAN()
    {
        const data = await this.#query(
            `select entity, knowledge from knowledge
                where entity like 'ilxtr:%' and source=?
                order by entity`,
            [this.#source])

        const pathsData = []
        for (const [key, jsonKnowledge] of data.values) {
            const knowledge = JSON.parse(jsonKnowledge)
            if ('connectivity' in knowledge) {
                const label = knowledge.label || key
                const shortLabel = (label === key.slice(6).replace('-prime', "'").replaceAll('-', ' ')) ? ''
                                 : (label.length < 50) ? label : `${label.slice(0, 50)}...`
                pathsData.push({
                    value: key,
                    label: shortLabel,
                })
                this.#knowledgeByPath.set(key, knowledge)
                this.#cacheLabels(knowledge)
            }
        }
        return pathsData
    }

    async #setPathList()
    //=================================================
    {
        this.#knowledgeByPath.clear()
        this.#labelledTerms = new Set()

        const data = this.#sourceFromMap
            ? await this.#setPathsFromMap()
            : await this.#setPathsFromSCKAN()

        const pathList: string[] = ['<option value="">Please select path:</option>']

        for (const {value, label} of data) {
            if (this.#path && this.#path === value) {
                pathList.push(`<option value="${value}" selected label="${value}&nbsp;&nbsp;${label}"></option>`)
            } else {
                pathList.push(`<option value="${value}" label="${value}&nbsp;&nbsp;${label}"></option>`)
            }
        }

        await this.#getCachedTermLabels()
        this.#pathSelector.innerHTML = pathList.join('')
    }

    async #getAvailableMaps()
    //================
    {
        try {
            const response = await fetch(this.#mapServer)
            if (!response.ok) {
                return []
            }
            return await response.json()
        } catch (error) {
            return []
        }
    }

    #setServerList()
    //==============
    {
        const serverList = []
        for (const key in MAP_ENDPOINTS) {
            const url = MAP_ENDPOINTS[key]
            if (!this.#mapServer) {
                this.#mapServer = url
            }
            const selected = this.#mapServer === url ? 'selected' : ''
            serverList.push(`<option value="${url}" ${selected}>${key}</option>`)
        }
        this.#serverSelector.innerHTML = serverList.join('')
    }

    async #setSourceList()
    //=====================================
    {
        const data = await this.#getJsonData<SourceList>(`${this.#mapServer}knowledge/sources`)
        const sources = data ? (data.sources || []) : []

        // Order with most recent first...
        const sourceList: string[] = []
        sourceList.push('<optgroup label="SCKAN Release:">')
        for (const source of sources) {
            if (source) {
                if (!this.#source) {
                    this.#source = source
                }
                if (this.#source === source) {
                    sourceList.push(`<option value="${source}" selected>${source}</option>`)
                } else {
                    sourceList.push(`<option value="${source}">${source}</option>`)
                }
            }
        }
        sourceList.push('</optgroup>')
        sourceList.push('<optgroup label="MAP:">')

        const availableMaps = []
        const mapSources = await this.#getAvailableMaps()

        mapSources.forEach((map: any) => {
            const { id, created } = map
            const duplicatedMap = availableMaps.find(_map => _map.id === id)
            const duplicatedMapIndex = availableMaps.findIndex(_map => _map.id === id)

            if (duplicatedMap) {
                if (duplicatedMap.created < created) {
                    availableMaps.splice(duplicatedMapIndex, 1, map)
                }
            } else {
                availableMaps.push(map)
            }
        });

        MAPS_TO_SHOW.forEach((map) => {
            const { id, name } = map
            const availableMap = availableMaps.find(_map => _map.id === id)

            if (availableMap) {
                const { uuid } = availableMap
                sourceList.push(`
                    <option value="${uuid}" ${this.#source === uuid ? 'selected' : ''}>
                        ${name}
                    </option>
                `)
            }
        })

        sourceList.push('</optgroup">')
        this.#sourceSelector.innerHTML = sourceList.join('')
    }
}

//==============================================================================
