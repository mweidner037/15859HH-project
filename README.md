# 15-858HH Final Project: O(log(n)) Time Text CRDT

`src/crdt/text_logn.ts` containts the text CRDT implementation. It has an API similar to Collabs's built-in `CText`, but a different implementation. It performs all operations in O(log(n) + c) time, where n is the text length including deleted elements, and c <= numUsers is the maximum amount of concurrency (concurrent edits at the same position).

As a demo, `npm start` runs the collaborative plain text editor from Collas's demos, but using this text CRDT instead of `CText.`

Except for the text CRDT, this repo is the mostly copied from Collabs's [plaintext editor demo](https://github.com/composablesys/collabs/tree/master/demos/apps/plaintext).

## Installation

First, install [Node.js](https://nodejs.org/). Then run `npm i`.

## Commands

### `npm run dev`

Build the container from `src/`, in [development mode](https://webpack.js.org/guides/development/).

### `npm run build`

Build the container from `src/`, in [production mode](https://webpack.js.org/guides/production/) (smaller output files; longer build time; no source maps).

### `npm start`

Run the demo server. Open [http://localhost:3000/](http://localhost:3000/) to view. Use multiple browser windows at once to test collaboration.

See [@collabs/container-testing-server](https://www.npmjs.com/package/@collabs/container-testing-server) for usage info.

### `npm run clean`

Delete `dist/`.
