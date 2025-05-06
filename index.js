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

import { App } from './src'

//==============================================================================

const searchParams = new URLSearchParams(location.search)
const MAP_SERVER = searchParams.get('server')
const SCKAN = searchParams.get('sckan')
const PATH = searchParams.get('path')
const LAYOUT = searchParams.get('layout')

//==============================================================================

const app = new App(MAP_SERVER, SCKAN, PATH, LAYOUT)

await app.run()

//==============================================================================
