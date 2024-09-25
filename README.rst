Connectivity Graph Viewer
=========================

A `Cytoscape.js <https://js.cytoscape.org/>`_ viewer for neuron connectivity graphs.

Installation
------------

::

    $ git clone https://github.com/AnatomicMaps/connectivity-graph.git
    $ cd connectivity-graph
    $ git checkout v0.2.0
    $ npm install

Configuration
-------------

1.  Set the ``MAP_SERVER`` constant in ``./index.js`` to the URL of a flatmap server
    which is running version ``v0.24.0`` or newer server code.

Building and running
--------------------

1.  If the connectivity viewer will be provided via a web server's endpoint, set the ``--build``
    option in the ``build`` command of ``./package.json`` to the relative path of the endpoint
    and run::

        $ npm run build

    This will create a set of files in the ``./dist`` directory that the server then needs to
    provide from requests to the endpoint.

2.  Otherwise run::

        $ npm start

    and reference the resulting ``localhost`` URL in a browser.

